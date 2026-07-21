"""
MongoDB connection and conversation storage.
Uses Motor (async driver) since FastAPI is async.
"""

from datetime import datetime, timezone
from uuid import uuid4

from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URI = "mongodb://localhost:27017"
DATABASE_NAME = "chat_project"

_client = None
_db = None


def init_db():
    """Call once at app startup."""
    global _client, _db
    _client = AsyncIOMotorClient(MONGO_URI)
    _db = _client[DATABASE_NAME]
    print("MongoDB connected.")


def shutdown_db():
    """Call once at app shutdown."""
    if _client is not None:
        _client.close()


def _now():
    return datetime.now(timezone.utc).isoformat()


async def create_conversation() -> str:
    """Creates a new empty conversation, returns its ID."""
    conversation_id = f"conv_{uuid4().hex[:12]}"
    await _db.conversations.insert_one({
        "_id": conversation_id,
        "created_at": _now(),
        "messages": [],
    })
    return conversation_id


async def add_message(conversation_id: str, role: str, content: str, sources=None) -> str:
    """Appends a message to a conversation, returns the new message's ID."""
    message_id = f"msg_{uuid4().hex[:12]}"
    message = {
        "id": message_id,
        "role": role,
        "content": content,
        "timestamp": _now(),
    }
    if role == "assistant":
        message["sources"] = sources or []
        message["feedback"] = None
        message["feedback_reason"] = None

    await _db.conversations.update_one(
        {"_id": conversation_id},
        {"$push": {"messages": message}},
    )
    return message_id


async def get_conversation(conversation_id: str):
    """Fetches a full conversation by ID, or None if it doesn't exist."""
    return await _db.conversations.find_one({"_id": conversation_id})