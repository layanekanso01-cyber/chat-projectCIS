"""
RAG pipeline for querying the CIS Controls v8 collection already stored in Weaviate.
Assumes ingestion (parsing/chunking/embedding/storage) was already done separately —
this module only handles live query-time retrieval, reranking, and generation.
"""

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

OLLAMA_URL = "http://localhost:11434/api/generate"
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


def _build_prompt(context: str, question: str) -> str:
    return f"""Answer the question using only the provided context.
If the answer is not available, say that you do not know.

Context:
{context}

Question:
{question}

Answer:
"""


def _generate_with_ollama(prompt_text: str, model: str = OLLAMA_MODEL) -> str:
    try:
        response = requests.post(
            OLLAMA_URL,
            json={"model": model, "prompt": prompt_text, "stream": False},
            timeout=120,
        )
        response.raise_for_status()
    except requests.exceptions.ConnectionError as error:
        raise RuntimeError(
            "Could not reach Ollama. Make sure 'ollama serve' is running "
            f"and the model has been pulled (e.g. 'ollama pull {model}')."
        ) from error
    return response.json()["response"]


def answer_question(question: str) -> dict:
    """Main entry point: takes a user question, returns an answer + sources."""
    start = time.perf_counter()

    documents = _retrieve_and_rerank(question)

    context = "\n\n".join(document.page_content for document in documents)
    prompt = _build_prompt(context, question)
    answer_text = _generate_with_ollama(prompt)

    sources = [
        {
            "source": document.metadata.get("source"),
            "chunk_id": int(document.metadata["chunk_id"]),
        }
        for document in documents
    ]

    latency = round(time.perf_counter() - start, 3)

    return {
        "answer": answer_text,
        "sources": sources,
        "latency_seconds": latency,
    }