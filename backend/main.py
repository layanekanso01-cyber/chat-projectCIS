from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from rag.pipeline import init_pipeline, shutdown_pipeline, answer_question


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_pipeline()
    yield
    shutdown_pipeline()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/chat")
def chat(request: ChatRequest):
    try:
        return answer_question(request.question)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error))