using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RagMiddleware.Infrastructure.RagApi;

namespace RagMiddleware.Api.Controllers;

/// <summary>
/// Everything the UI needs from the RAG system goes through here. The controller itself
/// knows nothing about chat, compliance checks, or conversations specifically — it just
/// forwards whatever comes in under /api/rag/* to the Python API via IRagApiClient,
/// which is the only place the shared credential is attached. [Authorize] means every
/// route here requires a valid JWT from our own Google-backed login.
/// </summary>
[ApiController]
[Authorize]
[Route("api/rag")]
public class RagProxyController : ControllerBase
{
    private readonly IRagApiClient _ragApiClient;

    public RagProxyController(IRagApiClient ragApiClient)
    {
        _ragApiClient = ragApiClient;
    }

    [HttpGet("{**path}")]
    [HttpPost("{**path}")]
    [HttpPatch("{**path}")]
    [HttpDelete("{**path}")]
    public async Task Proxy(string path)
    {
        await _ragApiClient.ProxyAsync(path, Request, Response, HttpContext.RequestAborted);
    }
}
