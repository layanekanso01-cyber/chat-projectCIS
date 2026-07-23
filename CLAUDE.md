\# CLAUDE.md



This file documents the project for AI coding assistants (Claude Code, GitHub Copilot, etc.) working in this repo.



\## What this is



A RAG-based chat application for the Dar Al-Handasah AI internship. Users ask questions

about the CIS Controls v8 document; the backend retrieves relevant chunks from an existing

Weaviate vector store, reranks them, and generates a grounded answer.



\## Tech stack



\- \*\*Backend:\*\* Python, FastAPI, LangChain, Weaviate (vector store), Ollama (local LLM generation)

\- \*\*Frontend:\*\* React (JavaScript, not TypeScript) + Vite, Tailwind CSS v4, shadcn/ui (Base UI + Nova preset)

\- \*\*Package management:\*\* pip + venv (backend), npm (frontend)



\## Project structure

chat-project/

backend/

main.py # FastAPI app: CORS, /health, /chat, /chat/stream, /conversations routes

rag/

pipeline.py # RAG query logic: retrieve, rerank, generate

db/

mongo.py # MongoDB conversation persistence (Motor)

venv/ # Python virtual environment (not committed)

frontend/

src/

components/

chat/ # ChatHeader, ChatViewport, ChatInput, MessageBubble, ConversationSidebar

citations/ # SourceCitations (hover tooltips)

feedback/ # FeedbackButtons, FeedbackDialog (thumbs up/down)

ui/ # shadcn-generated components (button, input, tooltip, dialog, textarea, etc.)

hooks/ # useChatStream (SSE consumption)

lib/ # shadcn utils

App.jsx # Top-level layout + backend fetch logic

node\_modules/ # (not committed)

\## Conventions



\- \*\*JavaScript, not TypeScript\*\* — deliberate choice for this project's timeline. Don't introduce `.ts`/`.tsx` files.

\- \*\*shadcn/ui components only\*\* for interactive UI elements (buttons, inputs, modals, accordions) — don't use raw HTML form elements or a different component library.

\- \*\*Ollama (`llama3.2:3b`), not Gemini\*\*, is the active generator for now — no API key required. Gemini code exists in the original research notebook but is not currently wired into the backend.

\- Security is a standing requirement, not an afterthought: `.env` files are gitignored, CORS is locked to `http://localhost:5173`, and all API request bodies use Pydantic models for validation.



\## Important: this is NOT the ingestion pipeline



`backend/rag/pipeline.py` only handles \*\*live queries\*\* against an \*\*already-populated\*\*

Weaviate collection (`CISControlsV8`). It does not parse PDFs, chunk text, or create

embeddings for storage — that one-time ingestion work lives in a separate project

(the original research notebook) and must be run first, independently, before this

backend can answer questions.



\## How to run this project locally



\*\*Prerequisites running first:\*\*

\- Docker Desktop, with Weaviate running on `localhost:8080` (with the `CISControlsV8` collection already populated)

\- `ollama serve` running locally, with `llama3.2:3b` pulled



\*\*Backend:\*\*

```bash

cd backend

venv\\Scripts\\activate

uvicorn main:app --reload

```

Runs on `http://127.0.0.1:8000`. Interactive API docs at `http://127.0.0.1:8000/docs`.



\*\*Frontend\*\* (separate terminal):

```bash

cd frontend

npm run dev

```

Runs on `http://localhost:5173`.



\## Testing



\*\*Backend\*\* (`backend/tests/`, pytest) — three tiers, run from `backend/` with the venv active:

```bash

pytest -m "not integration and not e2e"   # fast, pure logic only, no live services needed

pytest -m integration                     # needs Weaviate running (retrieval-dependent)

pytest -m e2e                             # needs Weaviate + Ollama, slow (real generation calls)

pytest                                    # everything

```

Each fixed bug this session (numbered-control retrieval, off-topic refusal, "why"/"answer them" routing, the Control 18 bipartite-matching gap, the compliance-checklist generic-title bug, Gemini's daily-vs-per-minute quota handling) has a regression test. One integration test (`test_safeguard_4_1_keyword_match_known_gap`) is a documented `xfail` tracking a known ingestion-level gap (Safeguards 1.1/4.1 have no matching chunk) — not a retrieval-logic bug.



\*\*Frontend\*\* (Vitest + React Testing Library, jsdom environment):

```bash

cd frontend

npm test

```

Covers `lib/utils.js` (date bucketing/filtering, markdown formatting, slugify) and the most interaction-heavy, self-contained components — `SourceCitations`/`SourceCard` (expand/collapse, copy-passage, citation-click force-open + highlight), `ComplianceChecklist` (status badges, progress text), `FollowUpSuggestions`, and `MessageActions` (conditional Show-sources/Regenerate visibility, version switcher). Test files are colocated with what they test (`Component.test.jsx`).

Still no coverage for `App.jsx` itself (the mode-separation / provider-tracking orchestration) or true E2E flows — that would need mocking `useChatStream`/`useConversations`/`fetch` or committing Playwright as a real dependency, both bigger lifts than component-level tests. The app's end-to-end behavior has been verified manually and via ad-hoc Playwright scripts throughout development, but nothing at that level is a committed, repeatable test yet.



One real bug worth knowing if you write more clipboard-related tests: `@testing-library/user-event`'s `setup()` installs its own `navigator.clipboard` mock, which will silently clobber a hand-rolled one if you stub the clipboard *before* calling `userEvent.setup()`. Stub it after.



\## Current status / roadmap



\- \[x] Backend project initialized (FastAPI)

\- \[x] Frontend project initialized (Vite + React + Tailwind + shadcn/ui)

\- \[x] RAG pipeline integrated into backend (`/chat` endpoint)

\- \[x] Static chat shell UI (header, viewport, input) connected to backend

\- \[x] SSE streaming (`/chat/stream`, `useChatStream` hook)

\- \[x] Source citations with hover tooltips

\- \[x] Chat history persistence (MongoDB)

\- \[x] Thumbs up/down feedback

\- \[x] Response regeneration (with version switching)

\- \[ ] Visual/UI polish pass

\- \[x] Automated regression tests (backend pytest — unit/integration/e2e; frontend Vitest — lib/utils.js)

