import { RAG_API_PREFIX } from "@/lib/config";
import { authFetch } from "@/api/httpClient";

async function request(path, options) {
  const response = await authFetch(`${RAG_API_PREFIX}${path}`, options);
  if (!response.ok) throw new Error(`Backend returned ${response.status}`);
  return response;
}

function patchJson(path, body) {
  return request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function listConversations() {
  const response = await request("/conversations");
  return response.json();
}

export async function getConversation(id) {
  const response = await request(`/conversations/${id}`);
  return response.json();
}

export function renameConversation(id, title) {
  return patchJson(`/conversations/${id}`, { title });
}

export function setConversationPinned(id, pinned) {
  return patchJson(`/conversations/${id}/pin`, { pinned });
}

export function deleteConversation(id) {
  return request(`/conversations/${id}`, { method: "DELETE" });
}

export function setMessageFeedback(conversationId, messageId, feedback, feedbackReason) {
  return patchJson(`/conversations/${conversationId}/messages/${messageId}/feedback`, {
    feedback,
    feedback_reason: feedbackReason ?? null,
  });
}

export function setActiveMessageVersion(conversationId, messageId, versionIndex) {
  return patchJson(`/conversations/${conversationId}/messages/${messageId}/active-version`, {
    version_index: versionIndex,
  });
}
