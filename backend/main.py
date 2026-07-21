from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from rag.pipeline import init_pipeline, shutdown_pipeline, answer_question
from db.mongo import init_db, shutdown_db, create_conversation, add_message, get_conversation


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
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)
    conversation_id: Optional[str] = None


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/chat")
async def chat(request: ChatRequest):
    # If no conversation_id was provided, start a new conversation.
    conversation_id = request.conversation_id
    if conversation_id is None:
        conversation_id = await create_conversation()

    # Save the user's message first.
    await add_message(conversation_id, "user", request.question)

    try:
        result = answer_question(request.question)
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
        "latency_seconds": result["latency_seconds"],
    }


@app.get("/conversations/{conversation_id}")
async def get_conversation_route(conversation_id: str):
    conversation = await get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation