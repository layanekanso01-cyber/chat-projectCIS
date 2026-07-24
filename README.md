# CIS Controls Assistant

A RAG-based chat application built for the Dar Al-Handasah AI internship. Users ask
questions about the CIS Controls v8 document; the system retrieves the relevant passages
from a vector store, reranks them, and generates a grounded, cited answer — with streaming
responses, source citations, conversation history, feedback, and an admin analytics
dashboard on top.

## Architecture

```
frontend (5173)  →  RagMiddleware.Api (5292)  →  Python RAG API (8000)
   React/Vite         .NET 9, auth + proxy          FastAPI + LangChain
                            │                              │
                            └── MongoDB (rag_middleware)    ├── Weaviate (CISControlsV8)
                                                             └── Ollama (llama3.2:3b)
                                                             │
                                                        MongoDB (chat_project)
```

The frontend never talks to the Python API directly. It authenticates against the .NET
middleware (Google OAuth → JWT), which reverse-proxies every `/api/rag/*` call to the
Python backend, attaching a shared credential the browser never sees. This also gives the
app a real audit log and an admin-only Insights dashboard, both backed by data the
middleware layer owns independently of the RAG service.

Retrieval itself is two-stage: a bi-encoder (`BAAI/bge-small-en-v1.5`) pulls the top-12
candidates from Weaviate by vector similarity, then a cross-encoder
(`cross-encoder/ms-marco-MiniLM-L6-v2`) rescores that pair jointly for a precise top-3,
which is what actually goes into the generation prompt.

## Tech stack

| Layer | Stack |
|---|---|
| RAG backend | Python, FastAPI, LangChain, Weaviate, Ollama (`llama3.2:3b`) |
| Middleware | .NET 9, ASP.NET Core, MongoDB.Driver, Google OAuth, JWT |
| Frontend | React (JavaScript, not TypeScript) + Vite, Tailwind CSS v4, shadcn/ui |
| Persistence | MongoDB (two logical databases: `chat_project` for conversations, `rag_middleware` for auth/audit) |

## Project structure

```
chat-project/
├── backend/                 # Python RAG API (FastAPI)
│   ├── main.py               # routes: /health, /chat, /chat/stream, /conversations, ...
│   ├── rag/pipeline.py        # retrieve → rerank → generate
│   ├── db/mongo.py            # conversation persistence (Motor)
│   └── tests/                 # pytest: unit / integration / e2e
├── frontend/                # React + Vite app
│   └── src/
│       ├── components/        # chat/, citations/, feedback/, admin/, auth/, ui/
│       ├── hooks/              # useChatStream (SSE), useConversations
│       └── api/                # backend/middleware fetch wrappers
└── middleware/               # .NET 9 reverse proxy + auth + audit (see middleware/README.md)
    └── RagMiddleware.{Api,Application,Domain,Infrastructure}
```

## Prerequisites

- Docker Desktop, with Weaviate running on `localhost:8080` (collection `CISControlsV8`
  already populated — ingestion is a separate one-time process, not part of this repo)
- `ollama serve` running locally, with `llama3.2:3b` pulled
- MongoDB running locally (`localhost:27017`)
- .NET 9 SDK
- A Google OAuth 2.0 Client ID (Web application) — see `middleware/README.md` for the
  exact redirect URI and how to configure it

## Running locally

Three processes, in order. Once the prerequisites above are already running (Weaviate
populated, Ollama serving, MongoDB up, a Google OAuth client configured), starting all
three from a fresh clone takes under 5 minutes — the time below is infra provisioning,
not this repo.

**1. Python RAG API**
```bash
cd backend
python -m venv venv && venv\Scripts\activate      # first time only
pip install -r requirements.txt                    # first time only
uvicorn main:app --reload
```
Runs on `http://127.0.0.1:8000`. Docs at `/docs`. Requires a `.env` with
`MIDDLEWARE_SHARED_KEY` set — see `middleware/README.md` for how the two sides share it.

**2. .NET middleware**
```bash
cd middleware/RagMiddleware.Api
dotnet run --launch-profile http
```
Runs on `http://localhost:5292`. Full config/setup in `middleware/README.md`.

**3. Frontend**
```bash
cd frontend
npm install       # first time only
npm run dev
```
Runs on `http://localhost:5173` — this is what you open in a browser.

The Python API is not reachable directly by the frontend by design; the middleware must
be running for the app to work end to end.

## Testing

**Backend** (`backend/tests/`, pytest — three tiers, run from `backend/` with the venv active):
```bash
pytest -m "not integration and not e2e"   # fast, pure logic, no live services needed
pytest -m integration                     # needs Weaviate running
pytest -m e2e                             # needs Weaviate + Ollama, slow (real generation)
```

**Frontend** (Vitest + React Testing Library):
```bash
cd frontend
npm test
```

## Notable design decisions

- **Off-topic refusal is deterministic, not LLM-judged.** A cosine-similarity threshold
  on the reranked top result decides whether a question is in scope, and returns a fixed
  message rather than trusting the 3B model to self-refuse (it doesn't, reliably).
- **A keyword-regex router, not an LLM classifier, decides whether retrieval is needed
  per turn.** An LLM classifier was tried first and rejected — on `llama3.2:3b` it was
  systematically biased toward skipping retrieval even for genuine document questions.
  A keyword match can only ever skip retrieval on an explicit match, which is the safer
  failure mode.
- **Numbered control/safeguard references and "list all 18 controls" bypass semantic
  search entirely**, fetching by literal number instead — k=3 retrieval can't cover an
  18-item enumeration, and the model would otherwise hallucinate plausible-sounding fake
  control names to fill the gap.

See `middleware/README.md` for the equivalent notes on the auth/proxy layer (secret
handling, rate limiting, audit logging), `CLAUDE.md` for the full contributor-facing
reference (conventions, further architectural detail, current roadmap), and
`AI_USAGE.md` for how Claude Code was used to build this project and what it actually
found and fixed.

## Status

Core chat flow (streaming, citations, history, feedback, regeneration), Google-authenticated
sessions, request auditing, and an admin analytics dashboard are all in place and tested.
Remaining open item: a dedicated visual/UI polish pass.
