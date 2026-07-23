import pytest
from rag.pipeline import init_pipeline, shutdown_pipeline


@pytest.fixture(scope="session")
def pipeline_ready():
    """Loads the embedding model/reranker and connects to Weaviate once for the whole
    test session — the same one-time setup init_pipeline() does for the real app.
    Only needed by tests that actually retrieve (integration/e2e); pure unit tests
    don't request this fixture and run without Weaviate/Ollama running at all."""
    init_pipeline()
    yield
    shutdown_pipeline()
