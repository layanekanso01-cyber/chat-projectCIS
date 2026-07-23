using Microsoft.AspNetCore.Http;

namespace RagMiddleware.Infrastructure.RagApi;

/// <summary>
/// The only place in the whole solution that ever attaches the RAG API's shared key to
/// a request. Everything under /api/rag/* goes through here rather than per-route
/// hand-written forwarding — the Python API exposes ~11 routes (chat, streaming chat,
/// streaming compliance check, conversation CRUD, feedback, versioning) and a generic
/// proxy mirrors all of them, including any added later, without a new controller
/// action per route.
/// </summary>
public interface IRagApiClient
{
    Task ProxyAsync(
        string path,
        HttpRequest incomingRequest,
        HttpResponse outgoingResponse,
        CancellationToken cancellationToken);
}
