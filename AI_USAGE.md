# AI Tooling: Usage & Impact

This project was built with **Claude Code** (Anthropic's CLI coding agent, Sonnet models)
as an active collaborator across the full stack — RAG pipeline, React frontend, .NET
middleware, test suites, and git hygiene. This document is honest about where it helped,
where it got things wrong, and where a human decision was required regardless of what the
model proposed. `CLAUDE.md` is the project-context artifact that makes this collaboration
possible (see below); this file is about the collaboration itself.

## How it was used

- **Implementation, end to end.** Most backend (`rag/pipeline.py`, `main.py`, `db/mongo.py`),
  frontend (`src/components/`, `src/hooks/`), and .NET middleware code in this repo was
  written by Claude Code under direction — feature by feature, with the human reviewing,
  redirecting, and making the calls that needed project-specific judgment.
- **Debugging via live verification, not just code reading.** The working discipline on
  this project was: reproduce with a real request, fix, then prove the fix with another
  real request — curl against the running API, direct MongoDB/Weaviate queries, or a
  scripted Playwright browser session — before calling anything done. Several real bugs
  were only found this way, not by reading the code:
  - A **regenerate-button race condition** where the button silently no-op'd — found by a
    full scripted Playwright pass through the happy path, not by reading `useChatStream`.
    Root cause: the hook's global `isStreaming` flag lagged per-message state by several
    seconds because of trailing SSE data.
  - An **Insights dashboard chart rendering invisible bars** — a CSS percentage-height bug
    (`items-end` on the flex parent meant percentage heights resolved against zero).
  - A **citation-truncation bug** reported by the user via screenshot — traced to a
    `_QUOTED_PASSAGE_MAX_CHARS = 220` constant in the backend. Rather than guess a new
    number, queried the live Weaviate collection directly for the real chunk-length
    distribution (109–998 chars, median 881) before picking 1200.
  - A **stale-process trap**: a code fix appeared not to work across multiple restarts
    because the process actually bound to port 8000 wasn't the one being restarted. Found
    by checking which PID actually owned the port, not by re-reading the fix.
- **Git history as a deliberate artifact, not an afterthought.** A large pile of
  pre-existing uncommitted work was reconstructed into honest, phase-based commits —
  including hand-rebuilding intermediate states of files that accumulated content across
  many phases, and surgically isolating one concern out of an otherwise-tangled diff
  (backup → reset → hand-apply → commit → restore) rather than committing everything as
  one undifferentiated blob.

## Where a proposed AI approach was tried and rejected

The most consequential judgment call in the RAG pipeline: **whether to route "does this
turn need document retrieval?" through an LLM classifier or a keyword-regex match.** The
LLM classifier was implemented and tested first. On the local `llama3.2:3b` model, it was
systematically biased toward "skip retrieval" — including for unambiguous genuine document
questions — which is the worse failure mode (a real question silently getting no context).
It was discarded in favor of `_needs_document_retrieval`'s regex-based router
(`backend/rag/pipeline.py`), which can only ever skip retrieval on an explicit small-talk
match and therefore can miss creative phrasing but can never misfire on a real question.
This is documented inline in the code, not just here — see the comment above
`_needs_document_retrieval`.

A second one: a user-supplied system-prompt rewrite explicitly said to "cite naturally."
Applying that literally would have silently broken `MessageBubble.jsx`'s citation
rendering, which parses literal `[1]`/`[2]` bracket citations by regex to build clickable
citation badges and hover tooltips. The bracket-citation requirement was kept in the
otherwise-restructured prompt — a case where the surface-level instruction and the actual
intent (better-structured guidance, not literally free-form citations) diverged, and
following the letter would have broken a working feature.

## Where AI guesses were wrong and had to be corrected

Not every proposal was right the first time:

- Two wrong namespace guesses for a .NET claim-mapping API
  (`Microsoft.AspNetCore.Authentication.OAuth.Claims`, which doesn't exist) before writing
  a throwaway reflection console app to enumerate the real assembly and find the actual
  answer (`ClaimActionCollectionMapExtensions.MapJsonKey`,
  `Microsoft.AspNetCore.Authentication`). Third guess would have been more of the same —
  reflection-driven discovery replaced guessing entirely.
- A JSX parse error from a single-quoted attribute containing an escaped apostrophe —
  caught by running the frontend, not by review.
- An invalid Tailwind class (`z-100`, not a real utility) — caught on self-review before
  it shipped, not after.

## Where the decision was always the human's

Claude Code proposed options; the choices below were made by the project owner, not
inferred:

- Whether to rewrite git history to remove AI co-authorship attribution (a force-push,
  confirmed explicitly before executing).
- Which of three fix strategies to use for the citation-truncation bug (raise the cap vs.
  remove it vs. add a UI show-more toggle) — the real Weaviate chunk-length data was
  gathered *after* this choice, to size the chosen approach correctly, not to make the
  choice itself.
- Whether the ~43-file pile of pre-existing uncommitted work should be organized with the
  same surgical, hunk-by-hunk rigor used for the .NET middleware, or grouped at the file
  level — explicitly presented as a real tradeoff (no external spec to justify the surgical
  approach on that pile), not decided silently.
- Scope and entry point of the admin Insights dashboard, and what the Day-4 feature brief
  actually required versus what was already covered.

## Net impact

The practical effect was less "AI writes code" and more "AI held the discipline of
verify-before-claiming-done" across a stack with four independently moving runtime pieces
(Weaviate, Ollama, MongoDB, .NET middleware) where a change in one layer routinely looked
correct until checked against a real request in the others. The bug list above is the
honest evidence for that — every one of them was caught by running something, not by
reading something.
