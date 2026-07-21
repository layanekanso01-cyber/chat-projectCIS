"""
RAG pipeline for querying the CIS Controls v8 collection already stored in Weaviate.
Assumes ingestion (parsing/chunking/embedding/storage) was already done separately —
this module only handles live query-time retrieval, reranking, and generation.
"""

import json
import re
import time
import requests
import weaviate
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_weaviate import WeaviateVectorStore
from sentence_transformers import CrossEncoder

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

# These are loaded once at startup, not per-request (loading them per-request
# would be extremely slow — the embedding model and reranker take real time to load).
_embedding_model = None
_reranker = None
_weaviate_client = None
_vector_store = None


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


def _all_control_overview_documents() -> list[Document]:
    """Fetches all 18 controls' overview chunks directly by number, for questions
    that need to enumerate the whole document (e.g. "list all 18 CIS Controls").
    Normal k_final=3 semantic retrieval can't cover this, and testing showed the
    model would rather hallucinate plausible-sounding fake control names than admit
    it can't see the full list — this gives it the real thing to enumerate from."""
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
        _weaviate_object_to_document(objects_by_chunk_id[assignment[number]])
        for number in sorted(assignment)
    ]


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
        reranked_fill = [document for document, score in ranked_results[:remaining_slots]]

    return keyword_documents + reranked_fill


_HISTORY_TURN_CHAR_LIMIT = 800

_SYSTEM_PROMPT = (
    "You are a friendly assistant that helps users learn about the CIS Controls v8 "
    "document, in an ongoing conversation. When the current question includes a Context "
    "section, use it to answer questions about the document's content. When there is no "
    "Context section, it means no document lookup was needed for this question — this "
    "happens for two kinds of messages: casual greetings or small talk (respond naturally "
    "and briefly, and mention you're happy to help with CIS Controls v8 questions), or "
    "requests to summarize, recap, or repeat something already discussed (answer using the "
    "conversation history above). If you don't have enough information to answer, say that "
    "you do not know."
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


def _needs_document_retrieval(question: str, history: list[dict] | None) -> bool:
    """Does this question need fresh document retrieval, or can it be answered without one
    (small talk, or "summarize what we discussed")? Defaults to True (retrieve) whenever the
    question doesn't match a known non-document pattern — retrieval is always the safe default."""
    stripped = question.strip()
    if _SMALL_TALK_PATTERN.match(stripped):
        return False
    if not history:
        return True
    return not _HISTORY_ONLY_PATTERN.search(stripped)


def _build_messages(context: str, question: str, history: list[dict] | None = None) -> list[dict]:
    """Builds an Ollama /api/chat messages array: a system prompt, the real conversation
    history as actual chat turns (not a flattened text block — models trained on multi-turn
    chat are far more reliable at referencing genuine prior turns than a summarized-in-prose
    version of them), then the current question — with its retrieved Context, if any."""
    messages = [{"role": "system", "content": _SYSTEM_PROMPT}]

    for turn in history or []:
        content = turn["content"]
        if len(content) > _HISTORY_TURN_CHAR_LIMIT:
            content = content[:_HISTORY_TURN_CHAR_LIMIT] + "..."
        messages.append({"role": turn["role"], "content": content})

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


def _documents_to_sources(documents) -> list[dict]:
    return [
        {
            "source": document.metadata.get("source"),
            "chunk_id": int(document.metadata["chunk_id"]),
        }
        for document in documents
    ]


def answer_question(question: str, history: list[dict] | None = None) -> dict:
    """Main entry point: takes a user question, returns an answer + sources.

    `history` is recent prior turns ({"role", "content"}, oldest first) so the
    model can handle follow-ups like "repeat that" that don't need fresh retrieval.
    """
    start = time.perf_counter()

    if _needs_document_retrieval(question, history):
        documents = _retrieve_and_rerank(question)
        context = "\n\n".join(document.page_content for document in documents)
    else:
        documents = []
        context = ""

    messages = _build_messages(context, question, history)
    answer_text = _generate_with_ollama(messages)

    latency = round(time.perf_counter() - start, 3)

    return {
        "answer": answer_text,
        "sources": _documents_to_sources(documents),
        "latency_seconds": latency,
    }


def stream_answer(question: str, history: list[dict] | None = None):
    """Generator version of answer_question for SSE streaming.

    `history` is recent prior turns ({"role", "content"}, oldest first) so the
    model can handle follow-ups like "repeat that" that don't need fresh retrieval.

    Yields, in order:
      ("sources", list[dict])       -- once, after retrieval/reranking
      ("token", str)                -- repeatedly, as Ollama streams tokens
      ("done", str)                 -- once, with the full concatenated answer
    """
    if _needs_document_retrieval(question, history):
        documents = _retrieve_and_rerank(question)
        context = "\n\n".join(document.page_content for document in documents)
    else:
        documents = []
        context = ""

    yield ("sources", _documents_to_sources(documents))

    messages = _build_messages(context, question, history)

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

    full_answer = ""
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