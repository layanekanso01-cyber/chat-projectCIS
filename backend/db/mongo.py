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
        message["versions"] = [
            {"content": content, "sources": sources or [], "timestamp": message["timestamp"]}
        ]
        message["active_version"] = 0

    await _db.conversations.update_one(
        {"_id": conversation_id},
        {"$push": {"messages": message}},
    )
    return message_id


async def get_conversation(conversation_id: str):
    """Fetches a full conversation by ID, or None if it doesn't exist."""
    return await _db.conversations.find_one({"_id": conversation_id})


async def get_recent_history(conversation_id: str, limit_turns: int = 3) -> list[dict]:
    """Returns the last `limit_turns` user/assistant exchanges (oldest first),
    as {"role", "content"} pairs, for feeding conversation context into generation."""
    conversation = await get_conversation(conversation_id)
    if conversation is None:
        return []
    messages = conversation.get("messages", [])[-(limit_turns * 2):]
    return [{"role": message["role"], "content": message["content"]} for message in messages]


async def set_message_feedback(
    conversation_id: str, message_id: str, feedback, feedback_reason
) -> bool:
    """Updates a message's feedback fields. Returns False if no matching message was found."""
    result = await _db.conversations.update_one(
        {"_id": conversation_id, "messages.id": message_id},
        {
            "$set": {
                "messages.$.feedback": feedback,
                "messages.$.feedback_reason": feedback_reason,
            }
        },
    )
    return result.matched_count > 0


async def add_message_version(conversation_id: str, message_id: str, content: str, sources=None):
    """Appends a new version to an assistant message and makes it active.

    Returns the new version's index, or None if the message wasn't found.
    Messages created before versioning existed have no `versions` field yet —
    in that case the message's current content is treated as version 0 before
    appending the new one.
    """
    doc = await _db.conversations.find_one(
        {"_id": conversation_id, "messages.id": message_id},
        {"messages.$": 1},
    )
    if not doc or not doc.get("messages"):
        return None

    existing = doc["messages"][0]
    versions = existing.get("versions") or [
        {
            "content": existing.get("content", ""),
            "sources": existing.get("sources", []),
            "timestamp": existing.get("timestamp"),
        }
    ]
    versions.append({"content": content, "sources": sources or [], "timestamp": _now()})
    new_index = len(versions) - 1

    await _db.conversations.update_one(
        {"_id": conversation_id, "messages.id": message_id},
        {
            "$set": {
                "messages.$.versions": versions,
                "messages.$.content": content,
                "messages.$.sources": sources or [],
                "messages.$.active_version": new_index,
            }
        },
    )
    return new_index


async def set_active_message_version(conversation_id: str, message_id: str, version_index: int) -> bool:
    """Switches which version of an assistant message is the active/displayed one."""
    doc = await _db.conversations.find_one(
        {"_id": conversation_id, "messages.id": message_id},
        {"messages.$": 1},
    )
    if not doc or not doc.get("messages"):
        return False

    versions = doc["messages"][0].get("versions") or []
    if version_index < 0 or version_index >= len(versions):
        return False

    version = versions[version_index]
    result = await _db.conversations.update_one(
        {"_id": conversation_id, "messages.id": message_id},
        {
            "$set": {
                "messages.$.active_version": version_index,
                "messages.$.content": version["content"],
                "messages.$.sources": version.get("sources", []),
            }
        },
    )
    return result.matched_count > 0


async def list_conversations(limit: int = 50) -> list[dict]:
    """Lightweight summaries of conversations, most recently created first."""
    cursor = (
        _db.conversations.find(
            {},
            {"_id": 1, "created_at": 1, "messages": {"$slice": 1}},
        )
        .sort("created_at", -1)
        .limit(limit)
    )

    summaries = []
    async for document in cursor:
        first_message = document["messages"][0] if document.get("messages") else None
        summaries.append(
            {
                "conversation_id": document["_id"],
                "created_at": document.get("created_at"),
                "preview": first_message["content"][:80] if first_message else None,
            }
        )
    return summaries