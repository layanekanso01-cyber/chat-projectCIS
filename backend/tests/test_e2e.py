"""Full end-to-end regression tests for the real bugs fixed this session — each of these
makes a real Ollama call, so this is the slowest tier (many seconds per test on CPU).
Needs Weaviate AND Ollama both running. Run with:
    pytest -m e2e
"""

import pytest

import rag.pipeline as pipeline

pytestmark = pytest.mark.e2e


def test_out_of_scope_question_is_refused_deterministically(pipeline_ready):
    # The core "Lebanon bug": the model would acknowledge a question was out of scope
    # and then answer it anyway from general knowledge. Fixed with a deterministic
    # short-circuit that never even calls the LLM for the answer text.
    result = pipeline.answer_question("Where is Lebanon located?")
    assert result["answer"] == pipeline.OUT_OF_SCOPE_MESSAGE
    assert result["sources"] == []


def test_small_talk_does_not_hallucinate_sources(pipeline_ready):
    result = pipeline.answer_question("hi")
    assert result["sources"] == []


def test_bare_why_after_refusal_does_not_retrieve_fresh_content(pipeline_ready):
    # After a refusal, "why" alone used to trigger a fresh, low-signal retrieval that
    # surfaced an unrelated chunk the model then confidently explained.
    history = [
        {"role": "user", "content": "Where is Lebanon located?"},
        {"role": "assistant", "content": pipeline.OUT_OF_SCOPE_MESSAGE},
    ]
    result = pipeline.answer_question("why", history=history)
    assert result["sources"] == []


def test_numbered_control_question_returns_grounded_answer(pipeline_ready):
    result = pipeline.answer_question("What is Control 1 about?")
    assert len(result["sources"]) > 0
    assert "asset" in result["answer"].lower()


def test_answer_them_resolves_multiple_prior_questions(pipeline_ready):
    # The multi-question bug: "answer them" used to retrieve on the literal phrase
    # "answer them" and hallucinate answers to an unrelated topic.
    history = [
        {"role": "user", "content": "give me 2 questions about CIS controls"},
        {"role": "assistant", "content": "1. What is Control 1?\n2. What is Control 2?"},
    ]
    result = pipeline.answer_question("answer them", history=history)
    assert len(result["sources"]) > 0
