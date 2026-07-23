export const MIDDLEWARE_URL = "http://localhost:5292";

// Every Python RAG API route is mirrored under this prefix by the .NET
// reverse-proxy controller (RagProxyController's {**path} catch-all).
export const RAG_API_PREFIX = "/api/rag";
