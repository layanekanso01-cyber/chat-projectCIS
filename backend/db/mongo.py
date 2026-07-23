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


_TITLE_MAX_LENGTH = 60


def _now():
    return datetime.now(timezone.utc).isoformat()


def _default_title(text: str) -> str:
    text = text.strip()
    return text[:_TITLE_MAX_LENGTH] + "..." if len(text) > _TITLE_MAX_LENGTH else text


def _with_effective_title(conversation: dict) -> dict:
    """A conversation's `title` is None until explicitly renamed — fall back to a
    truncated first user message so the sidebar always has something sensible to show."""
    if conversation.get("title"):
        return conversation
    first_user_message = next(
        (m for m in conversation.get("messages", []) if m["role"] == "user"), None
    )
    conversation["title"] = (
        _default_title(first_user_message["content"]) if first_user_message else "New conversation"
    )
    return conversation


async def create_conversation() -> str:
    """Creates a new empty conversation, returns its ID."""
    conversation_id = f"conv_{uuid4().hex[:12]}"
    now = _now()
    await _db.conversations.insert_one({
        "_id": conversation_id,
        "title": None,
        "pinned": False,
        "kind": "chat",
        "created_at": now,
        "updated_at": now,
        "messages": [],
    })
    return conversation_id


async def set_conversation_kind(conversation_id: str, kind: str) -> bool:
    """Marks a conversation as "chat" or "compliance" so the two modes' conversations
    never mix in the same thread — the frontend keeps a separate active conversation per
    mode and uses this to route a reopened conversation back to the right mode."""
    result = await _db.conversations.update_one(
        {"_id": conversation_id},
        {"$set": {"kind": kind}},
    )
    return result.matched_count > 0


async def add_message(
    conversation_id: str,
    role: str,
    content: str,
    sources=None,
    message_type: str = "text",
    checklist=None,
) -> str:
    """Appends a message to a conversation, returns the new message's ID."""
    message_id = f"msg_{uuid4().hex[:12]}"
    message = {
        "id": message_id,
        "role": role,
        "content": content,
        "type": message_type,
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
        if checklist is not None:
            message["checklist"] = checklist

    await _db.conversations.update_one(
        {"_id": conversation_id},
        {
            "$push": {"messages": message},
            "$set": {"updated_at": message["timestamp"]},
        },
    )
    return message_id


async def get_conversation(conversation_id: str):
    """Fetches a full conversation by ID, or None if it doesn't exist."""
    conversation = await _db.conversations.find_one({"_id": conversation_id})
    return _with_effective_title(conversation) if conversation else None


async def rename_conversation(conversation_id: str, title: str) -> bool:
    """Sets an explicit conversation title, overriding the default first-message fallback."""
    title = title.strip()
    if not title:
        return False
    result = await _db.conversations.update_one(
        {"_id": conversation_id},
        {"$set": {"title": title}},
    )
    return result.matched_count > 0


async def set_conversation_pinned(conversation_id: str, pinned: bool) -> bool:
    """Toggles a conversation's pinned state (pinned conversations sort to the top)."""
    result = await _db.conversations.update_one(
        {"_id": conversation_id},
        {"$set": {"pinned": pinned}},
    )
    return result.matched_count > 0


async def delete_conversation(conversation_id: str) -> bool:
    """Deletes a conversation entirely. Returns False if it didn't exist."""
    result = await _db.conversations.delete_one({"_id": conversation_id})
    return result.deleted_count > 0


async def get_recent_history(conversation_id: str, limit_turns: int = 3) -> list[dict]:
    """Returns the last `limit_turns` user/assistant exchanges (oldest first),
    as {"role", "content"} pairs, for feeding conversation context into generation."""
    conversation = await get_conversation(conversation_id)
    if conversation is None:
        return []
    messages = conversation.get("messages", [])[-(limit_turns * 2):]
    return [{"role": message["role"], "content": message["content"]} for message in messages]


async def set_message_feedback(
    conversation_id: str, message_id: str, feedback, feedback_reason, feedback_comment=None
) -> bool:
    """Updates a message's feedback fields. Returns False if no matching message was found."""
    result = await _db.conversations.update_one(
        {"_id": conversation_id, "messages.id": message_id},
        {
            "$set": {
                "messages.$.feedback": feedback,
                "messages.$.feedback_reason": feedback_reason,
                "messages.$.feedback_comment": feedback_comment,
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
    """Lightweight summaries of conversations, most recently active first."""
    cursor = (
        _db.conversations.find(
            {},
            {
                "_id": 1,
                "title": 1,
                "pinned": 1,
                "kind": 1,
                "created_at": 1,
                "updated_at": 1,
                "messages": {"$slice": 1},
            },
        )
        .sort([("pinned", -1), ("updated_at", -1)])
        .limit(limit)
    )

    summaries = []
    async for document in cursor:
        document = _with_effective_title(document)
        summaries.append(
            {
                "conversation_id": document["_id"],
                "title": document["title"],
                "pinned": document.get("pinned", False),
                "kind": document.get("kind", "chat"),
                "created_at": document.get("created_at"),
                "updated_at": document.get("updated_at", document.get("created_at")),
            }
        )
    return summaries