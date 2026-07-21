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

main.py # FastAPI app: CORS, /health, /chat routes

rag/

pipeline.py # RAG query logic: retrieve, rerank, generate

venv/ # Python virtual environment (not committed)

frontend/

src/

components/

chat/ # ChatHeader, ChatViewport, ChatInput, MessageBubble

citations/ # (planned) source citation display

feedback/ # (planned) thumbs up/down UI

ui/ # shadcn-generated components (button, input, etc.)

hooks/ # (planned) custom React hooks

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



\## Current status / roadmap



\- \[x] Backend project initialized (FastAPI)

\- \[x] Frontend project initialized (Vite + React + Tailwind + shadcn/ui)

\- \[x] RAG pipeline integrated into backend (`/chat` endpoint)

\- \[x] Static chat shell UI (header, viewport, input) connected to backend

\- \[ ] SSE streaming (planned next)

\- \[ ] Source citations with hover tooltips

\- \[ ] Chat history persistence (MongoDB)

\- \[ ] Thumbs up/down feedback

\- \[ ] Response regeneration

\- \[ ] Visual/UI polish pass

