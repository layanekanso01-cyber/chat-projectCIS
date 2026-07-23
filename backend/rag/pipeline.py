"""
RAG pipeline for querying the CIS Controls v8 collection already stored in Weaviate.
Assumes ingestion (parsing/chunking/embedding/storage) was already done separately —
this module only handles live query-time retrieval, reranking, and generation.
"""

import json
import os
import re
import time
import requests
import weaviate
from dotenv import load_dotenv
from google import genai
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_weaviate import WeaviateVectorStore
from sentence_transformers import CrossEncoder

load_dotenv()

WEAVIATE_HOST = "localhost"
WEAVIATE_PORT = 8080
WEAVIATE_GRPC_PORT = 50051
COLLECTION_NAME = "CISControlsV8"

OLLAMA_CHAT_URL = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "llama3.2:3b"
# Ollama's own default num_ctx is conservative and isn't raised just because the
# model supports a larger one — "list all 18 controls"-style questions can push
# input alone past 3500 tokens, so an explicit, generous window is needed to avoid
# silent truncation/context-shifting slowdowns. Timeout is raised to match: that
# much context measurably increases generation time on CPU.
OLLAMA_NUM_CTX = 8192
OLLAMA_TIMEOUT_SECONDS = 300

# Gemini is an optional alternative generator, picked per-request via the `provider`
# field the frontend sends (a global toggle in the UI, not a per-message choice). Ollama
# stays the default so the app still works with zero configuration.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_MODEL = "gemini-2.5-flash"

# These are loaded once at startup, not per-request (loading them per-request
# would be extremely slow — the embedding model and reranker take real time to load).
_embedding_model = None
_reranker = None
_weaviate_client = None
_vector_store = None
_gemini_client = None


def init_pipeline():
    """Call once at app startup. Loads models and connects to the existing
    Weaviate collection (does NOT re-ingest or delete anything)."""
    global _embedding_model, _reranker, _weaviate_client, _vector_store

    print("Loading embedding model...")
    _embedding_model = HuggingFaceEmbeddings(
        model_name="BAAI/bge-small-en-v1.5",
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )

    print("Loading reranker...")
    _reranker = CrossEncoder(
        "cross-encoder/ms-marco-MiniLM-L6-v2",
        device="cpu",
    )

    print("Connecting to Weaviate...")
    _weaviate_client = weaviate.connect_to_local(
        host=WEAVIATE_HOST,
        port=WEAVIATE_PORT,
        grpc_port=WEAVIATE_GRPC_PORT,
    )

    if not _weaviate_client.is_ready():
        raise RuntimeError("Weaviate is not ready. Is Docker running?")

    if not _weaviate_client.collections.exists(COLLECTION_NAME):
        raise RuntimeError(
            f"Collection '{COLLECTION_NAME}' not found in Weaviate. "
            "Run the ingestion notebook first to populate it."
        )

    _vector_store = WeaviateVectorStore(
        client=_weaviate_client,
        index_name=COLLECTION_NAME,
        text_key="text",
        embedding=_embedding_model,
    )

    print("RAG pipeline ready.")


def shutdown_pipeline():
    """Call once at app shutdown to close the Weaviate connection cleanly."""
    if _weaviate_client is not None:
        _weaviate_client.close()


# Matches "Control N" / "Safeguard N.M" mentions so numbered lookups can bypass
# semantic ranking (see _keyword_match_documents below for why).
_CONTROL_NUMBER_PATTERN = re.compile(r"\bcontrol\s+0?(\d{1,2})\b", re.IGNORECASE)
_SAFEGUARD_NUMBER_PATTERN = re.compile(r"\bsafeguard\s+(\d{1,2})\.(\d{1,2})\b", re.IGNORECASE)
_LIST_ALL_CONTROLS_PATTERN = re.compile(
    r"\ball\b(?:\s+\w+){0,3}\s+controls\b"
    r"|\bevery\s+control\b"
    r"|\b(full|complete)\s+list\b(?:\s+\w+){0,3}\s+controls\b"
    r"|\blist\b(?:\s+\w+){0,4}\s+controls\b",
    re.IGNORECASE,
)
_KEYWORD_SCAN_LIMIT = 500  # collection has ~307 chunks; scanning all of them is cheap
_TOTAL_CONTROLS = 18

# Minimum cross-encoder rerank score for a semantically-ranked chunk to be trusted as
# actually relevant, rather than just the least-irrelevant nearest neighbor. See
# _retrieve_and_rerank for the empirical basis (off-topic ~-10 to -11, on-topic >= -2.24).
MIN_RELEVANCE_SCORE = -6.0

OUT_OF_SCOPE_MESSAGE = (
    "I'm designed to answer questions about CIS Controls. Try asking about asset "
    "management, data protection, or incident response."
)

# Best-effort markers for labeling a source card with the control/safeguard it belongs
# to. There's no structured field for this in Weaviate (confirmed via schema inspection:
# only text/source/chunk_id exist) — page numbers were tried too and rejected, since bare
# digits in the text are ambiguous with table-of-contents references, but these two
# textual patterns are reliable enough to show as a best-effort label.
_SOURCE_CONTROL_LABEL_PATTERN = re.compile(r"\bControl\s+0?(\d{1,2})\b", re.IGNORECASE)
_SOURCE_SAFEGUARD_LABEL_PATTERN = re.compile(r"\b(\d{1,2})\.(\d{1,2})\s+[A-Z]")
_QUOTED_PASSAGE_MAX_CHARS = 220


def _extract_control_label(text: str) -> str | None:
    """Best-effort "Control N" / "Safeguard N.M" label for a source card. Checks for a
    control heading near the start of the chunk first (overview chunks open with "Control
    N: Title"); otherwise falls back to a safeguard-numbering match anywhere in the chunk
    (safeguard chunks open with "N.M Title"). Returns None if neither pattern is found —
    not every retrieved chunk (e.g. general prose) has an identifiable number."""
    control_match = _SOURCE_CONTROL_LABEL_PATTERN.search(text[:80])
    if control_match:
        return f"Control {int(control_match.group(1))}"
    safeguard_match = _SOURCE_SAFEGUARD_LABEL_PATTERN.search(text)
    if safeguard_match:
        return f"Safeguard {safeguard_match.group(1)}.{safeguard_match.group(2)}"
    return None


def _extract_quoted_passage(text: str) -> str:
    """A short, cleaned-up snippet of the chunk's raw text for the source card (collapses
    the stray newlines/page-number artifacts ingestion left in place)."""
    collapsed = re.sub(r"\s+", " ", text).strip()
    if len(collapsed) <= _QUOTED_PASSAGE_MAX_CHARS:
        return collapsed
    truncated = collapsed[:_QUOTED_PASSAGE_MAX_CHARS]
    last_space = truncated.rfind(" ")
    if last_space > 0:
        truncated = truncated[:last_space]
    return truncated + "..."


def _weaviate_object_to_document(obj) -> Document:
    return Document(
        page_content=obj.properties.get("text", ""),
        metadata={"source": obj.properties.get("source"), "chunk_id": obj.properties.get("chunk_id")},
    )


def _control_overview_pattern(number: str) -> re.Pattern:
    # Each control's overview chunk has its number, then (garbled/rotated "CONTROL"
    # text and) the title, then "SAFEGUARDS TOTAL" within a short span — this is the
    # most reliable literal marker found during testing.
    return re.compile(rf"\b0?{re.escape(number)}\b[\s\S]{{0,150}}?SAFEGUARDS\s+TOTAL")


def _keyword_match_documents(question: str, limit: int) -> list[Document]:
    """For questions naming a specific control/safeguard number (e.g. "Control 1",
    "Safeguard 4.1"), scans every chunk in the collection for a literal text marker
    identifying that exact section, bypassing embedding/rerank scoring entirely.

    Why: testing showed both the embedding model and the cross-encoder reranker are
    unreliable at distinguishing "Control 1" from "Control 14" etc. — the boilerplate
    text surrounding each control ("Why is this Control critical?", "SAFEGUARDS
    TOTAL"...) is nearly identical across all of them, so the correct chunk often
    doesn't even make the semantic top-k, and scores poorly with the reranker even
    when it does. A literal number match is a much stronger signal for this specific
    query shape than semantic similarity. The collection is small enough (~300
    chunks) that a full client-side scan on every request is cheap.
    """
    safeguard_match = _SAFEGUARD_NUMBER_PATTERN.search(question)
    control_match = _CONTROL_NUMBER_PATTERN.search(question)
    if not safeguard_match and not control_match:
        return []

    collection = _weaviate_client.collections.get(COLLECTION_NAME)
    all_objects = collection.query.fetch_objects(limit=_KEYWORD_SCAN_LIMIT).objects

    if safeguard_match:
        major, minor = safeguard_match.group(1), safeguard_match.group(2)
        # Safeguards are formatted as "4.1 Establish and Maintain..." at the start
        # of their own dedicated chunk text.
        pattern = re.compile(rf"\b{re.escape(major)}\.{re.escape(minor)}\s+[A-Z]")
    else:
        pattern = _control_overview_pattern(control_match.group(1))

    matches = [obj for obj in all_objects if pattern.search(obj.properties.get("text", ""))]
    return [_weaviate_object_to_document(obj) for obj in matches[:limit]]


def _assign_control_chunks(candidates_by_number: dict) -> dict:
    """Bipartite matching (Kuhn's algorithm): assigns each control number a distinct
    chunk_id from its own candidate list, maximizing how many controls get a match.
    Needed because adjacent controls' running page headers mean the same handful of
    chunks are candidates for multiple control numbers — a naive "first available"
    assignment can strand a later control with zero options even though a valid
    full assignment exists, since an earlier control could have taken a different
    one of its own candidates instead."""
    chunk_to_number: dict = {}

    def try_assign(number, visited: set) -> bool:
        for chunk_id in candidates_by_number.get(number, []):
            if chunk_id in visited:
                continue
            visited.add(chunk_id)
            if chunk_id not in chunk_to_number or try_assign(chunk_to_number[chunk_id], visited):
                chunk_to_number[chunk_id] = number
                return True
        return False

    for number in candidates_by_number:
        try_assign(number, set())

    return {number: chunk_id for chunk_id, number in chunk_to_number.items()}


def _all_control_overview_documents_with_numbers() -> list[tuple[int, Document]]:
    """Same lookup as _all_control_overview_documents, but keeps each document's control
    number attached. The "list all controls" path doesn't need the number (the model sees
    it in the text), but the compliance checklist judges coverage control by control and
    must label each result correctly."""
    collection = _weaviate_client.collections.get(COLLECTION_NAME)
    all_objects = collection.query.fetch_objects(limit=_KEYWORD_SCAN_LIMIT).objects
    objects_by_chunk_id = {int(obj.properties["chunk_id"]): obj for obj in all_objects}

    candidates_by_number = {}
    for number in range(1, _TOTAL_CONTROLS + 1):
        pattern = _control_overview_pattern(str(number))
        candidates_by_number[number] = [
            chunk_id
            for chunk_id, obj in objects_by_chunk_id.items()
            if pattern.search(obj.properties.get("text", ""))
        ]

    assignment = _assign_control_chunks(candidates_by_number)
    return [
        (number, _weaviate_object_to_document(objects_by_chunk_id[assignment[number]]))
        for number in sorted(assignment)
    ]


def _all_control_overview_documents() -> list[Document]:
    """Fetches all 18 controls' overview chunks directly by number, for questions
    that need to enumerate the whole document (e.g. "list all 18 CIS Controls").
    Normal k_final=3 semantic retrieval can't cover this, and testing showed the
    model would rather hallucinate plausible-sounding fake control names than admit
    it can't see the full list — this gives it the real thing to enumerate from."""
    return [document for _, document in _all_control_overview_documents_with_numbers()]


def _retrieve_and_rerank(question: str, k_vector: int = 12, k_final: int = 3):
    if _LIST_ALL_CONTROLS_PATTERN.search(question):
        overview_documents = _all_control_overview_documents()
        if overview_documents:
            return overview_documents

    keyword_documents = _keyword_match_documents(question, limit=k_final)

    results = _vector_store.similarity_search(query=question, k=k_vector)

    # Deduplicate by chunk_id (same logic as the notebook), also excluding anything
    # the keyword match already found so it isn't double-counted.
    unique_results = []
    seen_chunk_ids = {int(document.metadata["chunk_id"]) for document in keyword_documents}
    for document in results:
        current_id = int(document.metadata["chunk_id"])
        if current_id not in seen_chunk_ids:
            seen_chunk_ids.add(current_id)
            unique_results.append(document)
    results = unique_results

    remaining_slots = max(k_final - len(keyword_documents), 0)
    reranked_fill = []
    if remaining_slots and results:
        pairs = [[question, document.page_content] for document in results]
        scores = _reranker.predict(pairs, batch_size=8, show_progress_bar=False)
        ranked_results = sorted(zip(results, scores), key=lambda item: float(item[1]), reverse=True)
        # Only keep semantically-ranked results that clear a minimum relevance bar.
        # Without this, a genuinely off-topic question (e.g. "where is Lebanon
        # located") still gets handed the "least bad" nearest-neighbor CIS chunks as
        # Context, and the model answers from its own general knowledge instead of
        # refusing. Empirically: off-topic questions top out around -10 to -11;
        # genuine CIS questions, even vaguely phrased ones, score -2.24 or higher —
        # a wide, safe gap. Keyword-matched documents (literal control/safeguard
        # number hits) are exempt since those are trusted regardless of score.
        reranked_fill = [
            document
            for document, score in ranked_results[:remaining_slots]
            if float(score) >= MIN_RELEVANCE_SCORE
        ]

    return keyword_documents + reranked_fill


_HISTORY_TURN_CHAR_LIMIT = 800

_SYSTEM_PROMPT = (
    "You are a friendly assistant that helps users learn about the CIS Controls v8 "
    "document, in an ongoing conversation. When the current question includes a Context "
    "section, use it to answer questions about the document's content. The Context passages "
    "are numbered, like [1] and [2]. Whenever a sentence in your answer relies on a specific "
    "passage, cite it inline right after that sentence using its number in square brackets, "
    "e.g. \"Assets must be inventoried [1].\" Only use numbers that actually appear in the "
    "Context, and only cite a number where its passage was actually used. When there is no "
    "Context section, it means no document lookup was needed for this question — this "
    "happens for a few kinds of messages: casual greetings or small talk (respond naturally "
    "and briefly, and mention you're happy to help with CIS Controls v8 questions); requests "
    "to summarize, recap, or repeat something already discussed; or brief follow-ups like "
    "\"why\" or \"explain that\" asking you to clarify or justify your own previous answer "
    "(for any of these, answer using the actual conversation history above — don't invent "
    "new content). If you don't have enough information to answer, say that you do not know."
)

# Phrases that mean "answer from what we already discussed," not "look up the document."
# An LLM-based classifier for this was tried first and rejected: on llama3.2:3b it was
# systematically biased toward "HISTORY" even for unambiguous fresh document questions
# (e.g. "What is Safeguard 6.1?"), which would have silently broken real Q&A mid-conversation.
# A keyword match is a strictly safer default: it only ever skips retrieval on an explicit
# match, so it can miss creative phrasings but can't misfire on a genuine document question.
_HISTORY_ONLY_PATTERN = re.compile(
    r"\bsummar(y|ize|ise|izing|ising)\b"
    r"|\brecap\b"
    r"|\brepeat\b"
    r"|\bsay that again\b"
    r"|\bwhat did (you|we) (just )?(say|discuss|talk about)\b"
    r"|\bwhat have we discussed\b"
    r"|\bwhat was your (last|previous) answer\b"
    r"|\bgo over that again\b"
    r"|\bremind me what\b",
    re.IGNORECASE,
)

# Standalone greetings/small talk — matched against the *whole* message (not a substring
# search like the pattern above) so it doesn't misfire on real questions that happen to
# contain "hi" or "thanks" somewhere in them.
_SMALL_TALK_PATTERN = re.compile(
    r"^(hi|hello|hey|hiya|yo|sup|good (morning|afternoon|evening)|"
    r"how('s| is) it going|how are you|"
    r"thanks|thank you|thx|ty|"
    r"ok|okay|cool|great|nice( one)?|sounds good|"
    r"bye|goodbye|see (ya|you)|later)[\s!.,?]*$",
    re.IGNORECASE,
)

# Bare causal/clarifying follow-ups ("why", "why not", "explain that") — these only make
# sense in light of the assistant's own previous turn, so they must be answered from
# conversation history, not fresh retrieval. Whole-message match (like small talk above):
# "why does Control 6 matter" is a real document question and must NOT match this.
# Found via a real bug: after a refusal, "why" alone triggered a fresh, low-signal
# retrieval that surfaced an unrelated chunk, which the model then confidently explained
# instead of clarifying its own prior answer.
_CLARIFICATION_FOLLOWUP_PATTERN = re.compile(
    r"^(why( not|(\s+is)? that)?|how come|explain( that| why)?|what do you mean|elaborate)"
    r"[\s!.,?]*$",
    re.IGNORECASE,
)

# "Answer them" / "answer those questions" — refers to MULTIPLE prior questions (e.g. a
# numbered list the assistant just suggested). This can't be handled the same way as
# "why"/"repeat that": those need no new document grounding, but properly answering N
# different real CIS questions needs N separate retrievals, not one retrieval on the
# literal phrase "answer them" (which has no real signal and, in testing, surfaced an
# unrelated chunk that the model then invented a whole new unrelated Q&A around).
_ANSWER_PRIOR_QUESTIONS_PATTERN = re.compile(
    r"^((can|could) you\s+)?(please\s+)?"
    r"answer (them|these|those|it|all( of them)?|each( of them)?|the(se|m)? questions)"
    r"[\s!.,?]*$",
    re.IGNORECASE,
)

_MULTI_QUESTION_K_FINAL = 2  # fewer chunks per sub-question, since there can be several


def _find_prior_questions(history: list[dict]) -> list[str]:
    """Best-effort: pulls individual question sentences out of the most recent
    assistant turn (e.g. a numbered list of suggested questions it just gave), so
    "answer them" can be resolved to the real questions instead of retrieved as
    literal text. Returns [] if that turn doesn't look like a list of questions."""
    for turn in reversed(history):
        if turn["role"] != "assistant":
            continue
        questions = []
        for line in re.split(r"\n+", turn["content"]):
            cleaned = re.sub(r"^\s*(\d+[.)]|[-*])\s*", "", line).strip()
            if cleaned.endswith("?"):
                questions.append(cleaned)
        return questions
    return []


def _multi_question_context(history: list[dict]):
    """For "answer them"-style follow-ups: extracts the actual questions from the most
    recent assistant turn and runs a separate retrieval for each, since a single
    retrieval on "answer them" itself has no real signal to work with. Returns
    (user_content, documents) ready for the final chat turn, or None if no questions
    could be extracted (caller falls back to normal single-question handling)."""
    questions = _find_prior_questions(history)
    if not questions:
        return None

    blocks = []
    all_documents = []
    seen_chunk_ids = set()
    for index, sub_question in enumerate(questions, start=1):
        documents = _retrieve_and_rerank(sub_question, k_final=_MULTI_QUESTION_K_FINAL)
        if documents:
            context = "\n\n".join(document.page_content for document in documents)
            for document in documents:
                chunk_id = int(document.metadata["chunk_id"])
                if chunk_id not in seen_chunk_ids:
                    seen_chunk_ids.add(chunk_id)
                    all_documents.append(document)
        else:
            context = "(No relevant information found in the CIS Controls v8 document for this question.)"
        blocks.append(f"Question {index}: {sub_question}\nContext for Question {index}:\n{context}")

    user_content = (
        "Please answer each of the following questions in turn, clearly labeled, "
        "using only the context provided under each one:\n\n" + "\n\n".join(blocks)
    )
    return user_content, all_documents


def _needs_document_retrieval(question: str, history: list[dict] | None) -> bool:
    """Does this question need fresh document retrieval, or can it be answered without one
    (small talk, "summarize what we discussed", or a bare "why"/"explain that" follow-up)?
    Defaults to True (retrieve) whenever the question doesn't match a known non-document
    pattern — retrieval is always the safe default."""
    stripped = question.strip()
    if _SMALL_TALK_PATTERN.match(stripped):
        return False
    if not history:
        return True
    if _CLARIFICATION_FOLLOWUP_PATTERN.match(stripped):
        return False
    return not _HISTORY_ONLY_PATTERN.search(stripped)


def _build_messages(
    context: str,
    question: str,
    history: list[dict] | None = None,
    override_user_content: str | None = None,
) -> list[dict]:
    """Builds an Ollama /api/chat messages array: a system prompt, the real conversation
    history as actual chat turns (not a flattened text block — models trained on multi-turn
    chat are far more reliable at referencing genuine prior turns than a summarized-in-prose
    version of them), then the current question — with its retrieved Context, if any.
    `override_user_content`, when given, replaces the normal Context/Question templating
    entirely (used for the multi-question "answer them" case)."""
    messages = [{"role": "system", "content": _SYSTEM_PROMPT}]

    for turn in history or []:
        content = turn["content"]
        if len(content) > _HISTORY_TURN_CHAR_LIMIT:
            content = content[:_HISTORY_TURN_CHAR_LIMIT] + "..."
        messages.append({"role": turn["role"], "content": content})

    if override_user_content is not None:
        user_content = override_user_content
    else:
        user_content = f"Context:\n{context}\n\nQuestion:\n{question}" if context else question
    messages.append({"role": "user", "content": user_content})
    return messages


def _raise_ollama_error(error: requests.exceptions.RequestException, model: str):
    if isinstance(error, requests.exceptions.Timeout):
        raise RuntimeError(
            "Ollama took too long to respond. This can happen on questions that "
            "need a lot of context (e.g. asking to list everything) on slower "
            "hardware — try again, or ask a more specific question."
        ) from error
    raise RuntimeError(
        "Could not reach Ollama. Make sure 'ollama serve' is running "
        f"and the model has been pulled (e.g. 'ollama pull {model}')."
    ) from error


def _generate_with_ollama(messages: list[dict], model: str = OLLAMA_MODEL) -> str:
    try:
        response = requests.post(
            OLLAMA_CHAT_URL,
            json={
                "model": model,
                "messages": messages,
                "stream": False,
                "options": {"num_ctx": OLLAMA_NUM_CTX},
            },
            timeout=OLLAMA_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except requests.exceptions.RequestException as error:
        _raise_ollama_error(error, model)
    return response.json()["message"]["content"]


def _get_gemini_client() -> genai.Client:
    global _gemini_client
    if _gemini_client is None:
        if not GEMINI_API_KEY:
            raise RuntimeError(
                "Gemini isn't configured. Add GEMINI_API_KEY to backend/.env and restart "
                "the backend, or switch back to Ollama."
            )
        _gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    return _gemini_client


def _messages_to_gemini(messages: list[dict]):
    """Ollama/OpenAI-style {"role", "content"} messages use a flat array with "system"
    as just another entry; Gemini instead takes system instructions as a separate
    top-level parameter and only "user"/"model" roles in `contents`, so the two need
    translating rather than sharing one message-building path."""
    system_instruction = None
    contents = []
    for message in messages:
        if message["role"] == "system":
            system_instruction = message["content"]
            continue
        role = "model" if message["role"] == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": message["content"]}]})
    return system_instruction, contents


# Gemini's free tier caps at both a per-minute burst limit and a per-day total (as low as
# 20/day on some keys) — the compliance checklist's 18 back-to-back calls can hit either.
# Only the per-minute kind is worth retrying: a per-day quota won't recover no matter how
# long this process waits, so retrying it just stalls the request for no benefit.
_GEMINI_MAX_ATTEMPTS = 4
_GEMINI_RETRY_DELAY_SECONDS = 15


def _is_retryable_gemini_error(error: Exception) -> bool:
    text = str(error)
    return "RESOURCE_EXHAUSTED" in text and "PerDay" not in text


def _raise_gemini_error(error: Exception):
    text = str(error)
    if "RESOURCE_EXHAUSTED" in text and "PerDay" in text:
        raise RuntimeError(
            "Gemini's free-tier daily quota is used up for today. Try again tomorrow, "
            "or switch to Ollama in the model picker."
        ) from error
    if "RESOURCE_EXHAUSTED" in text:
        raise RuntimeError(
            "Gemini is temporarily rate-limited. Try again in a moment, or switch to "
            "Ollama in the model picker."
        ) from error
    raise RuntimeError(f"Could not reach Gemini: {error}") from error


def _generate_with_gemini(messages: list[dict], model: str = GEMINI_MODEL) -> str:
    client = _get_gemini_client()
    system_instruction, contents = _messages_to_gemini(messages)
    last_error = None
    for attempt in range(_GEMINI_MAX_ATTEMPTS):
        try:
            response = client.models.generate_content(
                model=model,
                contents=contents,
                config={"system_instruction": system_instruction},
            )
            return response.text
        except Exception as error:
            last_error = error
            if _is_retryable_gemini_error(error) and attempt < _GEMINI_MAX_ATTEMPTS - 1:
                time.sleep(_GEMINI_RETRY_DELAY_SECONDS)
                continue
            break
    _raise_gemini_error(last_error)


def _generate(messages: list[dict], provider: str = "ollama") -> str:
    """Single-shot generation, routed to whichever provider the request asked for. Every
    non-streaming call site (main answers, follow-ups, compliance classification) goes
    through this instead of calling a provider-specific function directly."""
    if provider == "gemini":
        return _generate_with_gemini(messages)
    return _generate_with_ollama(messages)


_FOLLOW_UP_SYSTEM_PROMPT = (
    "Given a question and answer about the CIS Controls v8 document, suggest exactly 3 "
    "short, specific follow-up questions the user might naturally ask next, based only on "
    "the content of the answer. Reply with ONLY the 3 questions, one per line, no numbering "
    "or extra commentary."
)


def _generate_follow_up_questions(question: str, answer: str, provider: str = "ollama") -> list[str]:
    """One extra, fast call after the main answer, suggesting related follow-ups.
    Best-effort: this must never break the main answer, so any failure here is swallowed
    and just yields no suggestions rather than raising."""
    try:
        raw = _generate([
            {"role": "system", "content": _FOLLOW_UP_SYSTEM_PROMPT},
            {"role": "user", "content": f"Question: {question}\nAnswer: {answer}"},
        ], provider=provider)
    except RuntimeError:
        return []

    questions = []
    for line in raw.splitlines():
        cleaned = re.sub(r"^\s*(\d+[.)]|[-*])\s*", "", line).strip()
        if cleaned:
            questions.append(cleaned)
    return questions[:3]


def _documents_to_sources(documents) -> list[dict]:
    return [
        {
            "source": document.metadata.get("source"),
            "chunk_id": int(document.metadata["chunk_id"]),
            "control_label": _extract_control_label(document.page_content),
            "quote": _extract_quoted_passage(document.page_content),
        }
        for document in documents
    ]


def _documents_to_context(documents) -> str:
    """Numbers each passage ([1], [2], ...) so the model can cite them inline and the
    frontend can turn "[1]" in the rendered answer into a link to the matching source
    card — the numbering here must match `_documents_to_sources`' list order exactly."""
    return "\n\n".join(
        f"[{index}] {document.page_content}" for index, document in enumerate(documents, start=1)
    )


def answer_question(question: str, history: list[dict] | None = None, provider: str = "ollama") -> dict:
    """Main entry point: takes a user question, returns an answer + sources.

    `history` is recent prior turns ({"role", "content"}, oldest first) so the
    model can handle follow-ups like "repeat that" that don't need fresh retrieval.
    `provider` picks the generator backend ("ollama" or "gemini") for this request.
    """
    start = time.perf_counter()

    if history and _ANSWER_PRIOR_QUESTIONS_PATTERN.match(question.strip()):
        multi = _multi_question_context(history)
        if multi is not None:
            override_user_content, documents = multi
            messages = _build_messages(
                "", question, history, override_user_content=override_user_content
            )
            answer_text = _generate(messages, provider=provider)
            return {
                "answer": answer_text,
                "sources": _documents_to_sources(documents),
                "follow_up_questions": _generate_follow_up_questions(
                    question, answer_text, provider=provider
                ),
                "latency_seconds": round(time.perf_counter() - start, 3),
            }

    needs_retrieval = _needs_document_retrieval(question, history)
    if needs_retrieval:
        documents = _retrieve_and_rerank(question)
        if not documents:
            # Retrieval ran but found nothing relevant enough to trust — this is a
            # genuinely out-of-scope question. Answer deterministically rather than
            # asking the LLM to refuse: testing showed it doesn't reliably comply
            # and will answer from its own general knowledge instead (e.g. actually
            # answering "where is Lebanon located" after acknowledging it's off-topic).
            return {
                "answer": OUT_OF_SCOPE_MESSAGE,
                "sources": [],
                "follow_up_questions": [],
                "latency_seconds": round(time.perf_counter() - start, 3),
            }
        context = _documents_to_context(documents)
    else:
        documents = []
        context = ""

    messages = _build_messages(context, question, history)
    answer_text = _generate(messages, provider=provider)

    latency = round(time.perf_counter() - start, 3)

    return {
        "answer": answer_text,
        "sources": _documents_to_sources(documents),
        "follow_up_questions": (
            _generate_follow_up_questions(question, answer_text, provider=provider)
            if needs_retrieval
            else []
        ),
        "latency_seconds": latency,
    }


def stream_answer(question: str, history: list[dict] | None = None, provider: str = "ollama"):
    """Generator version of answer_question for SSE streaming.

    `history` is recent prior turns ({"role", "content"}, oldest first) so the
    model can handle follow-ups like "repeat that" that don't need fresh retrieval.
    `provider` picks the generator backend ("ollama" or "gemini") for this request.

    Yields, in order:
      ("sources", list[dict])       -- once, after retrieval/reranking
      ("token", str)                -- repeatedly, as Ollama streams tokens
      ("done", str)                 -- once, with the full concatenated answer
      ("follow_ups", list[str])     -- once, after "done", if follow-ups were generated
    """
    override_user_content = None
    is_multi_question = False
    if history and _ANSWER_PRIOR_QUESTIONS_PATTERN.match(question.strip()):
        multi = _multi_question_context(history)
        if multi is not None:
            override_user_content, documents = multi
            is_multi_question = True
        else:
            documents = None
    else:
        documents = None

    needs_retrieval = False
    if override_user_content is None:
        needs_retrieval = _needs_document_retrieval(question, history)
        if needs_retrieval:
            documents = _retrieve_and_rerank(question)
            if not documents:
                # See answer_question for why this is a deterministic short-circuit
                # rather than an LLM refusal instruction.
                yield ("sources", [])
                yield ("token", OUT_OF_SCOPE_MESSAGE)
                yield ("done", OUT_OF_SCOPE_MESSAGE)
                return
            context = _documents_to_context(documents)
        else:
            documents = []
            context = ""
    else:
        context = ""  # unused: override_user_content already has Context embedded per sub-question

    yield ("sources", _documents_to_sources(documents))

    messages = _build_messages(context, question, history, override_user_content=override_user_content)

    full_answer = ""
    if provider == "gemini":
        client = _get_gemini_client()
        system_instruction, contents = _messages_to_gemini(messages)
        # Same rate-limit retry as _generate_with_gemini, but only retries while nothing
        # has been streamed to the client yet — once tokens are already out, a 429 mid-
        # stream just has to surface as an error rather than silently restarting.
        for attempt in range(_GEMINI_MAX_ATTEMPTS):
            try:
                stream = client.models.generate_content_stream(
                    model=GEMINI_MODEL,
                    contents=contents,
                    config={"system_instruction": system_instruction},
                )
                for chunk in stream:
                    token = chunk.text or ""
                    if token:
                        full_answer += token
                        yield ("token", token)
                break
            except Exception as error:
                if (
                    _is_retryable_gemini_error(error)
                    and not full_answer
                    and attempt < _GEMINI_MAX_ATTEMPTS - 1
                ):
                    time.sleep(_GEMINI_RETRY_DELAY_SECONDS)
                    continue
                _raise_gemini_error(error)
    else:
        try:
            response = requests.post(
                OLLAMA_CHAT_URL,
                json={
                    "model": OLLAMA_MODEL,
                    "messages": messages,
                    "stream": True,
                    "options": {"num_ctx": OLLAMA_NUM_CTX},
                },
                timeout=OLLAMA_TIMEOUT_SECONDS,
                stream=True,
            )
            response.raise_for_status()
        except requests.exceptions.RequestException as error:
            _raise_ollama_error(error, OLLAMA_MODEL)

        for line in response.iter_lines():
            if not line:
                continue
            chunk = json.loads(line)
            token = chunk.get("message", {}).get("content", "")
            if token:
                full_answer += token
                yield ("token", token)
            if chunk.get("done"):
                break

    yield ("done", full_answer)

    if needs_retrieval or is_multi_question:
        yield ("follow_ups", _generate_follow_up_questions(question, full_answer, provider=provider))


# --- Compliance checklist mode -------------------------------------------------
# Judges a pasted security-setup description against each of the 18 CIS Controls in
# turn. Deliberately one focused judgment per Control rather than one big "analyze
# everything" call: the model is small (llama3.2:3b) and has already shown, in the
# out-of-scope refusal and multi-question fixes above, that it's unreliable at both
# following exact output structure and reasoning over many things at once. A narrow,
# single-Control question with a strict two-line answer format is a much easier task
# to get right, and a defensively-parsed fallback ("Unclear") means a single bad
# response can't corrupt the whole checklist.

_CONTROL_TITLE_PATTERN = re.compile(r"\bControl\s+0?(\d{1,2})\s*:\s*([^\n]{1,80})", re.IGNORECASE)


def _all_control_titles() -> dict:
    """Best-effort {control_number: title}, found via the literal "Control N: Title"
    heading scanned across every chunk. Kept separate from the overview-chunk lookup in
    _all_control_overview_documents_with_numbers, because that lookup's bipartite matching
    sometimes assigns a control number to a chunk that mentions the number without
    containing its actual title (e.g. an implementation-group breakdown table) — scanning
    for the literal heading text directly is more reliable for the title specifically."""
    collection = _weaviate_client.collections.get(COLLECTION_NAME)
    all_objects = collection.query.fetch_objects(limit=_KEYWORD_SCAN_LIMIT).objects
    titles: dict[int, str] = {}
    for obj in all_objects:
        for match in _CONTROL_TITLE_PATTERN.finditer(obj.properties.get("text", "")):
            number = int(match.group(1))
            if 1 <= number <= _TOTAL_CONTROLS and number not in titles:
                titles[number] = match.group(2).strip()
    return titles


_COMPLIANCE_SYSTEM_PROMPT = (
    "You are assessing whether a described security setup satisfies ONE specific CIS "
    "Control. You will be given that Control's official text and a description of an "
    "organization's current security setup. Judge only this Control, based only on what "
    "the description actually says — do not assume anything it doesn't mention. Respond "
    "in EXACTLY this format and nothing else:\n"
    "STATUS: <Covered, Partial, or Gap>\n"
    "REASON: <one sentence, referencing the setup description>"
)

_COMPLIANCE_STATUS_PATTERN = re.compile(r"STATUS:\s*(Covered|Partial|Gap)", re.IGNORECASE)
_COMPLIANCE_REASON_PATTERN = re.compile(r"REASON:\s*(.+)", re.IGNORECASE)
_COMPLIANCE_VALID_STATUSES = {"covered": "Covered", "partial": "Partial", "gap": "Gap"}


def _classify_control_coverage(control_text: str, description: str, provider: str = "ollama") -> dict:
    """One classification call for a single Control. See the module comment above for why
    this is a narrow per-Control call instead of one big analysis, and why the parse below
    falls back to "Unclear" instead of trusting the model followed the format."""
    try:
        raw = _generate([
            {"role": "system", "content": _COMPLIANCE_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Control:\n{control_text}\n\nSecurity setup description:\n{description}",
            },
        ], provider=provider)
    except RuntimeError as error:
        return {"status": "Unclear", "reason": str(error)}

    status_match = _COMPLIANCE_STATUS_PATTERN.search(raw)
    reason_match = _COMPLIANCE_REASON_PATTERN.search(raw)
    status = _COMPLIANCE_VALID_STATUSES.get(
        status_match.group(1).lower() if status_match else "", "Unclear"
    )
    reason = reason_match.group(1).strip() if reason_match else raw.strip()[:300]
    return {"status": status, "reason": reason}


def run_compliance_check(description: str, provider: str = "ollama"):
    """Generator: judges a pasted security-setup description against each of the 18 CIS
    Controls in turn, yielding one result at a time (~18 sequential calls) so the
    frontend can render progress instead of waiting silently for a couple of minutes.

    Yields:
      ("item", dict)        -- once per Control, in order
      ("done", list[dict])  -- once, with the full checklist
    """
    checklist = []
    titles = _all_control_titles()
    for number, document in _all_control_overview_documents_with_numbers():
        title = titles.get(number, f"Control {number}")
        result = _classify_control_coverage(document.page_content, description, provider=provider)
        item = {
            "control_number": number,
            "control_title": title,
            "status": result["status"],
            "reason": result["reason"],
        }
        checklist.append(item)
        yield ("item", item)

    yield ("done", checklist)


def checklist_to_markdown(checklist: list[dict]) -> str:
    """Renders a checklist as plain markdown — this becomes the message's `content`
    field, so existing text-based features (copy, export, conversation history) work
    on a compliance report without any special-casing."""
    lines = ["## Compliance Check Results", ""]
    for item in checklist:
        lines.append(
            f"{item['control_number']}. **Control {item['control_number']}: "
            f"{item['control_title']}** — {item['status']}"
        )
        lines.append(f"   {item['reason']}")
        lines.append("")
    return "\n".join(lines)