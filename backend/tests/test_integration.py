"""Retrieval-dependent tests — need a live Weaviate connection (loads the embedding
model + reranker via the pipeline_ready fixture). No Ollama/Gemini calls, so still
fast-ish (seconds, not the minutes a full compliance run takes). Run with:
    pytest -m integration
"""

import pytest

import rag.pipeline as pipeline

pytestmark = pytest.mark.integration


def test_control_1_keyword_match_returns_correct_chunk(pipeline_ready):
    # Regression coverage for the bug where semantic search couldn't tell "Control 1"
    # apart from "Control 14" — this bypasses semantic scoring entirely.
    docs = pipeline._keyword_match_documents("What is Control 1 about?", limit=3)
    assert len(docs) > 0
    pattern = pipeline._control_overview_pattern("1")
    assert any(pattern.search(doc.page_content) for doc in docs)


def test_safeguard_6_1_keyword_match(pipeline_ready):
    docs = pipeline._keyword_match_documents("What is Safeguard 6.1?", limit=3)
    assert len(docs) > 0
    assert any("6.1" in doc.page_content for doc in docs)


@pytest.mark.xfail(
    reason="Known ingestion-level gap: Safeguards 1.1 and 4.1 have no chunk matching "
    "the keyword pattern in the vector store — confirmed as an ingestion issue, not a "
    "retrieval-logic bug, and out of scope for this app (ingestion is a separate project).",
    strict=True,
)
def test_safeguard_4_1_keyword_match_known_gap(pipeline_ready):
    docs = pipeline._keyword_match_documents("What is Safeguard 4.1?", limit=3)
    assert len(docs) > 0


def test_unrelated_question_has_no_keyword_match(pipeline_ready):
    assert pipeline._keyword_match_documents("How does the weather work?", limit=3) == []


def test_all_18_controls_overview_documents_present(pipeline_ready):
    # Regression coverage for the bipartite-matching bug that stranded Control 18
    # when a naive "first available" assignment gave its only candidate to Control 17.
    docs_with_numbers = pipeline._all_control_overview_documents_with_numbers()
    numbers = [number for number, _ in docs_with_numbers]
    assert numbers == list(range(1, 19))


def test_all_control_titles_are_real_not_generic(pipeline_ready):
    # Regression coverage for the "Control 12: Control 12" fallback-title bug.
    titles = pipeline._all_control_titles()
    assert len(titles) == 18
    for number, title in titles.items():
        assert title != f"Control {number}", f"Control {number} fell back to a generic title"
        assert len(title) > 5


def test_off_topic_question_is_filtered_out(pipeline_ready):
    # Regression coverage for the "Lebanon" bug — the model would answer from its own
    # general knowledge instead of refusing when handed the nearest-neighbor CIS chunks.
    assert pipeline._retrieve_and_rerank("Where is Lebanon located?") == []


def test_on_topic_question_returns_documents(pipeline_ready):
    documents = pipeline._retrieve_and_rerank("How should software assets be managed?")
    assert len(documents) > 0


def test_list_all_controls_pattern_triggers_full_overview(pipeline_ready):
    documents = pipeline._retrieve_and_rerank("list all 18 CIS controls")
    assert len(documents) >= 15
