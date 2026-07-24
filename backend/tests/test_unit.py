"""Fast, no-live-services tests for pipeline.py's pure logic: regex routing, text
extraction, and formatting. These don't need Weaviate/Ollama running — they just
import rag.pipeline and call functions directly. Run with:
    pytest -m "not integration and not e2e"
"""

import pytest
from langchain_core.documents import Document

import rag.pipeline as pipeline


class TestControlLabelExtraction:
    def test_control_overview_chunk(self):
        text = "36\n\nControl 13: Network Monitoring and Defense\n\nSAFEGUARDS TOTAL"
        assert pipeline._extract_control_label(text) == "Control 13"

    def test_safeguard_chunk(self):
        text = "4.1 Establish and Maintain a Secure Configuration Process"
        assert pipeline._extract_control_label(text) == "Safeguard 4.1"

    def test_no_marker_returns_none(self):
        assert pipeline._extract_control_label("Some unrelated paragraph of text.") is None


class TestQuotedPassageExtraction:
    def test_collapses_whitespace(self):
        text = "Line one\n\n   Line   two\nLine three"
        result = pipeline._extract_quoted_passage(text)
        assert "\n" not in result
        assert "  " not in result

    def test_truncates_long_text(self):
        text = "word " * 300
        result = pipeline._extract_quoted_passage(text)
        assert len(result) <= pipeline._QUOTED_PASSAGE_MAX_CHARS + 4
        assert result.endswith("...")

    def test_short_text_left_unchanged(self):
        assert pipeline._extract_quoted_passage("Short passage.") == "Short passage."


class TestRetrievalRouting:
    """Regression coverage for the 'repeat that' / bare-'why' / small-talk bugs."""

    def test_fresh_question_needs_retrieval(self):
        assert pipeline._needs_document_retrieval("What is Safeguard 6.1?", None) is True

    def test_fresh_question_needs_retrieval_even_with_history(self):
        history = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "Hello!"}]
        assert pipeline._needs_document_retrieval("What is Control 4 about?", history) is True

    def test_small_talk_skips_retrieval(self):
        assert pipeline._needs_document_retrieval("hi", None) is False
        assert pipeline._needs_document_retrieval("thanks!", None) is False

    def test_bare_why_only_skips_retrieval_with_history(self):
        # No history to explain -> "why" is a real (if underspecified) question.
        assert pipeline._needs_document_retrieval("why", None) is True
        history = [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]
        assert pipeline._needs_document_retrieval("why", history) is False
        assert pipeline._needs_document_retrieval("why not", history) is False

    def test_real_question_containing_why_still_retrieves(self):
        # Must not be swallowed by the bare-"why" clarification pattern.
        history = [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]
        assert pipeline._needs_document_retrieval("why does Control 6 matter", history) is True

    def test_summarize_skips_retrieval(self):
        history = [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]
        assert pipeline._needs_document_retrieval("can you summarize that", history) is False


class TestMultiQuestionPattern:
    def test_answer_them_matches(self):
        assert pipeline._ANSWER_PRIOR_QUESTIONS_PATTERN.match("answer them")
        assert pipeline._ANSWER_PRIOR_QUESTIONS_PATTERN.match("Can you answer these questions?")

    def test_real_question_does_not_match(self):
        assert not pipeline._ANSWER_PRIOR_QUESTIONS_PATTERN.match("What is Control 4?")

    def test_find_prior_questions_extracts_numbered_list(self):
        history = [
            {"role": "user", "content": "give me 5 questions"},
            {
                "role": "assistant",
                "content": "1. What is Control 1?\n2. What is Control 2?\nAn intro line with no question mark",
            },
        ]
        assert pipeline._find_prior_questions(history) == [
            "What is Control 1?",
            "What is Control 2?",
        ]


class TestCitationNumbering:
    """Regression coverage for the inline [n] citation feature — numbering here must
    stay in lockstep with _documents_to_sources' list order."""

    def test_documents_to_context_numbers_in_order(self):
        docs = [
            Document(page_content="first chunk", metadata={"chunk_id": 1}),
            Document(page_content="second chunk", metadata={"chunk_id": 2}),
        ]
        context = pipeline._documents_to_context(docs)
        assert context.startswith("[1] first chunk")
        assert "[2] second chunk" in context

    def test_documents_to_sources_extracts_control_label(self):
        docs = [
            Document(
                page_content="Control 3: Data Protection\n...SAFEGUARDS TOTAL",
                metadata={"source": "x.pdf", "chunk_id": 5},
            ),
        ]
        sources = pipeline._documents_to_sources(docs)
        assert sources[0]["chunk_id"] == 5
        assert sources[0]["control_label"] == "Control 3"


class TestComplianceParsing:
    def test_well_formatted_response_parses(self):
        raw = "STATUS: Gap\nREASON: No MFA is mentioned anywhere in the description."
        status_match = pipeline._COMPLIANCE_STATUS_PATTERN.search(raw)
        reason_match = pipeline._COMPLIANCE_REASON_PATTERN.search(raw)
        assert status_match.group(1) == "Gap"
        assert "No MFA" in reason_match.group(1)

    def test_checklist_to_markdown_formats_all_items(self):
        checklist = [
            {
                "control_number": 1,
                "control_title": "Inventory and Control of Enterprise Assets",
                "status": "Gap",
                "reason": "No inventory.",
            },
        ]
        markdown = pipeline.checklist_to_markdown(checklist)
        assert "Control 1: Inventory and Control of Enterprise Assets" in markdown
        assert "Gap" in markdown
        assert "No inventory." in markdown


class TestGeminiErrorClassification:
    """Regression coverage for the bug where a daily-quota 429 was retried for ~45s
    before failing, instead of failing fast like a per-minute limit shouldn't."""

    def test_daily_quota_error_is_not_retryable(self):
        error = Exception(
            "429 RESOURCE_EXHAUSTED ... 'quotaId': 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'"
        )
        assert pipeline._is_retryable_gemini_error(error) is False

    def test_per_minute_error_is_retryable(self):
        error = Exception(
            "429 RESOURCE_EXHAUSTED ... 'quotaId': 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier'"
        )
        assert pipeline._is_retryable_gemini_error(error) is True

    def test_non_quota_error_is_not_retryable(self):
        assert pipeline._is_retryable_gemini_error(Exception("connection refused")) is False

    def test_daily_quota_raises_friendly_message(self):
        error = Exception("429 RESOURCE_EXHAUSTED ... PerDay ...")
        with pytest.raises(RuntimeError, match="daily quota"):
            pipeline._raise_gemini_error(error)

    def test_per_minute_quota_raises_different_friendly_message(self):
        error = Exception("429 RESOURCE_EXHAUSTED ... PerMinute ...")
        with pytest.raises(RuntimeError, match="temporarily rate-limited"):
            pipeline._raise_gemini_error(error)
