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
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_weaviate import WeaviateVectorStore
from sentence_transformers import CrossEncoder

WEAVIATE_HOST = "localhost"
WEAVIATE_PORT = 8080
WEAVIATE_GRPC_PORT = 50051
COLLECTION_NAME = "CISControlsV8"

OLLAMA_CHAT_URL = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "llama3.2:3b"

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


def _retrieve_and_rerank(question: str, k_vector: int = 12, k_final: int = 3):
    results = _vector_store.similarity_search(query=question, k=k_vector)

    # Deduplicate by chunk_id (same logic as the notebook)
    unique_results = []
    seen_chunk_ids = set()
    for document in results:
        current_id = int(document.metadata["chunk_id"])
        if current_id not in seen_chunk_ids:
            seen_chunk_ids.add(current_id)
            unique_results.append(document)
    results = unique_results

    pairs = [[question, document.page_content] for document in results]
    scores = _reranker.predict(pairs, batch_size=8, show_progress_bar=False)

    ranked_results = sorted(
        zip(results, scores),
        key=lambda item: float(item[1]),
        reverse=True,
    )

    return [document for document, score in ranked_results[:k_final]]


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


def _generate_with_ollama(messages: list[dict], model: str = OLLAMA_MODEL) -> str:
    try:
        response = requests.post(
            OLLAMA_CHAT_URL,
            json={"model": model, "messages": messages, "stream": False},
            timeout=120,
        )
        response.raise_for_status()
    except requests.exceptions.ConnectionError as error:
        raise RuntimeError(
            "Could not reach Ollama. Make sure 'ollama serve' is running "
            f"and the model has been pulled (e.g. 'ollama pull {model}')."
        ) from error
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
            json={"model": OLLAMA_MODEL, "messages": messages, "stream": True},
            timeout=120,
            stream=True,
        )
        response.raise_for_status()
    except requests.exceptions.ConnectionError as error:
        raise RuntimeError(
            "Could not reach Ollama. Make sure 'ollama serve' is running "
            f"and the model has been pulled (e.g. 'ollama pull {OLLAMA_MODEL}')."
        ) from error

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