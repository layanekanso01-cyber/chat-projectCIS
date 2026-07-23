import { authFetch } from "@/api/httpClient";

// Mirrors AuditLoggingMiddleware.ClassifyAction on the .NET side.
export const AUDIT_LOG_ACTIONS = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "LOGIN_INITIATED",
  "TOKEN_REFRESH_SUCCESS",
  "TOKEN_REFRESH_FAILED",
  "LOGOUT",
  "ADMIN_AUDIT_VIEW",
  "ADMIN_INSIGHTS_VIEW",
  "RAG_QUERY",
  "RAG_COMPLIANCE_CHECK",
  "RAG_PROXY",
];

export async function fetchAuditLogs({ limit = 50, offset = 0, userEmail, path, action, from, to } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (userEmail) params.set("userEmail", userEmail);
  if (path) params.set("path", path);
  if (action) params.set("action", action);
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const response = await authFetch(`/api/admin/audit-logs?${params}`);
  if (!response.ok) throw new Error(`Backend returned ${response.status}`);
  return response.json();
}

export async function fetchInsights() {
  const response = await authFetch("/api/admin/insights");
  if (!response.ok) throw new Error(`Backend returned ${response.status}`);
  return response.json();
}
