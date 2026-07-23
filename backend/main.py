import json
import os
from contextlib import asynccontextmanager
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from starlette.concurrency import iterate_in_threadpool

load_dotenv()

from rag.pipeline import (
    init_pipeline,
    shutdown_pipeline,
    answer_question,
    stream_answer,
    run_compliance_check,
    checklist_to_markdown,
)
from db.mongo import (
    init_db,
    shutdown_db,
    create_conversation,
    add_message,
    add_message_version,
    delete_conversation,
    get_conversation,
    get_recent_history,
    list_conversations,
    rename_conversation,
    set_conversation_kind,
    set_conversation_pinned,
    set_message_feedback,
    set_active_message_version,
)

HISTORY_TURN_LIMIT = 3


def _trim_history(messages: list[dict], limit_turns: int = HISTORY_TURN_LIMIT) -> list[dict]:
    """Keeps only the last `limit_turns` exchanges from an in-memory message list,
    mapped down to {"role", "content"} for feeding into generation."""
    trimmed = messages[-(limit_turns * 2):]
    return [{"role": message["role"], "content": message["content"]} for message in trimmed]


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_pipeline()
    init_db()
    yield
    shutdown_pipeline()
    shutdown_db()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)

# Only the .NET middleware knows this key — the browser/UI never does. This is what
# makes the credential-hiding promise in the middleware project real: even if someone
# points a browser straight at this API, every route but /health returns 401 without it.
MIDDLEWARE_SHARED_KEY = os.environ.get("MIDDLEWARE_SHARED_KEY")
_PUBLIC_PATHS = {"/health"}


@app.middleware("http")
async def require_middleware_key(request: Request, call_next):
    if request.method != "OPTIONS" and request.url.path not in _PUBLIC_PATHS:
        if not MIDDLEWARE_SHARED_KEY or request.headers.get("X-Middleware-Key") != MIDDLEWARE_SHARED_KEY:
            return JSONResponse(status_code=401, content={"detail": "Missing or invalid middleware key"})
    return await call_next(request)


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)
    conversation_id: Optional[str] = None
    provider: Literal["ollama", "gemini"] = "ollama"


class RegenerateRequest(BaseModel):
    provider: Literal["ollama", "gemini"] = "ollama"


class FeedbackRequest(BaseModel):
    feedback: Optional[Literal["up", "down"]] = None
    feedback_reason: Optional[str] = Field(None, max_length=500)
    feedback_comment: Optional[str] = Field(None, max_length=500)


class ActiveVersionRequest(BaseModel):
    version_index: int = Field(..., ge=0)


class RenameConversationRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)


class ComplianceCheckRequest(BaseModel):
    description: str = Field(..., min_length=1, max_length=4000)
    conversation_id: Optional[str] = None
    provider: Literal["ollama", "gemini"] = "ollama"


class PinConversationRequest(BaseModel):
    pinned: bool


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/chat")
async def chat(request: ChatRequest):
    # If no conversation_id was provided, start a new conversation.
    conversation_id = request.conversation_id
    if conversation_id is None:
        conversation_id = await create_conversation()

    history = await get_recent_history(conversation_id, limit_turns=HISTORY_TURN_LIMIT)

    # Save the user's message first.
    await add_message(conversation_id, "user", request.question)

    try:
        result = answer_question(request.question, history=history, provider=request.provider)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error))

    # Save the assistant's answer, with sources.
    message_id = await add_message(
        conversation_id,
        "assistant",
        result["answer"],
        sources=result["sources"],
    )

    return {
        "conversation_id": conversation_id,
        "message_id": message_id,
        "answer": result["answer"],
        "sources": result["sources"],
        "follow_up_questions": result["follow_up_questions"],
        "latency_seconds": result["latency_seconds"],
    }


def _sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


def _sse_response(question: str, history: list[dict], on_done, provider: str = "ollama"):
    """Streams stream_answer(question, history) as SSE frames, calling `on_done(full_answer,
    sources)` -> dict once generation finishes, and yielding that dict as the
    final "done" frame. `on_done` is where callers persist the result to Mongo."""

    async def event_generator():
        sources = []
        try:
            async for event_type, payload in iterate_in_threadpool(
                stream_answer(question, history=history, provider=provider)
            ):
                if event_type == "sources":
                    sources = payload
                    yield _sse_event("sources", {"sources": sources})
                elif event_type == "token":
                    yield _sse_event("token", {"text": payload})
                elif event_type == "done":
                    done_payload = await on_done(payload, sources)
                    yield _sse_event("done", done_payload)
                elif event_type == "follow_ups":
                    yield _sse_event("follow_ups", {"questions": payload})
        except RuntimeError as error:
            yield _sse_event("error", {"detail": str(error)})

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=_SSE_HEADERS)


@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    conversation_id = request.conversation_id
    if conversation_id is None:
        conversation_id = await create_conversation()

    history = await get_recent_history(conversation_id, limit_turns=HISTORY_TURN_LIMIT)

    # Save the user's message before streaming starts.
    await add_message(conversation_id, "user", request.question)

    async def on_done(full_answer, sources):
        message_id = await add_message(conversation_id, "assistant", full_answer, sources=sources)
        return {"conversation_id": conversation_id, "message_id": message_id}

    return _sse_response(request.question, history, on_done, provider=request.provider)


@app.post("/conversations/{conversation_id}/messages/{message_id}/regenerate")
async def regenerate_message_route(conversation_id: str, message_id: str, request: RegenerateRequest):
    conversation = await get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = conversation.get("messages", [])
    target_index = next((i for i, m in enumerate(messages) if m["id"] == message_id), None)
    if target_index is None or messages[target_index]["role"] != "assistant":
        raise HTTPException(status_code=404, detail="Assistant message not found")

    preceding_messages = messages[:target_index]
    user_indices = [i for i, m in enumerate(preceding_messages) if m["role"] == "user"]
    if not user_indices:
        raise HTTPException(
            status_code=400, detail="No preceding user question found to regenerate from"
        )

    user_index = user_indices[-1]
    question = preceding_messages[user_index]["content"]
    # History is everything before the question being regenerated, not including
    # the (about to be replaced) answer itself.
    history = _trim_history(preceding_messages[:user_index])

    async def on_done(full_answer, sources):
        version_index = await add_message_version(
            conversation_id, message_id, full_answer, sources=sources
        )
        return {
            "conversation_id": conversation_id,
            "message_id": message_id,
            "version_index": version_index,
        }

    return _sse_response(question, history, on_done, provider=request.provider)


@app.post("/compliance-check/stream")
async def compliance_check_stream(request: ComplianceCheckRequest):
    conversation_id = request.conversation_id
    if conversation_id is None:
        conversation_id = await create_conversation()
    await set_conversation_kind(conversation_id, "compliance")

    await add_message(conversation_id, "user", request.description)

    async def event_generator():
        checklist = []
        try:
            async for event_type, payload in iterate_in_threadpool(
                run_compliance_check(request.description, provider=request.provider)
            ):
                if event_type == "item":
                    checklist.append(payload)
                    yield _sse_event("item", payload)
                elif event_type == "done":
                    content = checklist_to_markdown(payload)
                    message_id = await add_message(
                        conversation_id,
                        "assistant",
                        content,
                        message_type="compliance_report",
                        checklist=payload,
                    )
                    yield _sse_event(
                        "done", {"conversation_id": conversation_id, "message_id": message_id}
                    )
        except RuntimeError as error:
            yield _sse_event("error", {"detail": str(error)})

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=_SSE_HEADERS)


@app.get("/conversations")
async def list_conversations_route(limit: int = 50):
    return await list_conversations(limit=limit)


@app.get("/conversations/{conversation_id}")
async def get_conversation_route(conversation_id: str):
    conversation = await get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.patch("/conversations/{conversation_id}")
async def rename_conversation_route(conversation_id: str, request: RenameConversationRequest):
    updated = await rename_conversation(conversation_id, request.title)
    if not updated:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"conversation_id": conversation_id, "title": request.title.strip()}


@app.patch("/conversations/{conversation_id}/pin")
async def set_pin_route(conversation_id: str, request: PinConversationRequest):
    updated = await set_conversation_pinned(conversation_id, request.pinned)
    if not updated:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"conversation_id": conversation_id, "pinned": request.pinned}


@app.delete("/conversations/{conversation_id}")
async def delete_conversation_route(conversation_id: str):
    deleted = await delete_conversation(conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"conversation_id": conversation_id, "deleted": True}


@app.patch("/conversations/{conversation_id}/messages/{message_id}/feedback")
async def set_feedback_route(conversation_id: str, message_id: str, request: FeedbackRequest):
    updated = await set_message_feedback(
        conversation_id,
        message_id,
        request.feedback,
        request.feedback_reason,
        request.feedback_comment,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Message not found")
    return {
        "conversation_id": conversation_id,
        "message_id": message_id,
        "feedback": request.feedback,
        "feedback_reason": request.feedback_reason,
        "feedback_comment": request.feedback_comment,
    }


@app.patch("/conversations/{conversation_id}/messages/{message_id}/active-version")
async def set_active_version_route(conversation_id: str, message_id: str, request: ActiveVersionRequest):
    updated = await set_active_message_version(conversation_id, message_id, request.version_index)
    if not updated:
        raise HTTPException(status_code=404, detail="Message or version not found")
    return {
        "conversation_id": conversation_id,
        "message_id": message_id,
        "active_version": request.version_index,
    }
