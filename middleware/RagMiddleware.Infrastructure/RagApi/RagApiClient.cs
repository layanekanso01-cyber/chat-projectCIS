using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace RagMiddleware.Infrastructure.RagApi;

public class RagApiClient : IRagApiClient
{
    // Headers that only make sense hop-by-hop or that we set ourselves — copying these
    // through verbatim from the upstream response would either be wrong (Kestrel sets
    // its own Transfer-Encoding) or would leak the shared key back toward the browser.
    private static readonly HashSet<string> ExcludedResponseHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Transfer-Encoding",
        "X-Middleware-Key",
    };

    private readonly HttpClient _httpClient;
    private readonly RagApiOptions _options;
    private readonly ILogger<RagApiClient> _logger;

    public RagApiClient(HttpClient httpClient, IOptions<RagApiOptions> options, ILogger<RagApiClient> logger)
    {
        _httpClient = httpClient;
        _options = options.Value;
        _logger = logger;
    }

    public async Task ProxyAsync(
        string path,
        HttpRequest incomingRequest,
        HttpResponse outgoingResponse,
        CancellationToken cancellationToken)
    {
        var targetUri = new Uri($"/{path}{incomingRequest.QueryString}", UriKind.Relative);

        using var forwardRequest = new HttpRequestMessage(new HttpMethod(incomingRequest.Method), targetUri);

        if (incomingRequest.ContentLength is > 0 || incomingRequest.Headers.ContainsKey("Transfer-Encoding"))
        {
            forwardRequest.Content = new StreamContent(incomingRequest.Body);
            if (incomingRequest.ContentType is not null)
            {
                forwardRequest.Content.Headers.TryAddWithoutValidation("Content-Type", incomingRequest.ContentType);
            }
        }

        // This is the one and only place the RAG API's shared key gets attached — the
        // UI's request never carries it, and it's stripped from the response below.
        forwardRequest.Headers.TryAddWithoutValidation("X-Middleware-Key", _options.ApiKey);

        HttpResponseMessage upstreamResponse;
        try
        {
            // ResponseHeadersRead is what makes SSE streaming work: without it, HttpClient
            // buffers the entire response body before returning, which for a multi-minute
            // compliance-check stream would mean the browser sees nothing until the whole
            // thing finishes — defeating the point of streaming entirely.
            upstreamResponse = await _httpClient.SendAsync(
                forwardRequest, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Could not reach the RAG API for {Path}", path);
            outgoingResponse.StatusCode = StatusCodes.Status502BadGateway;
            await outgoingResponse.WriteAsJsonAsync(
                new { detail = "Could not reach the RAG API." }, cancellationToken: CancellationToken.None);
            return;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // The browser disconnected (e.g. user clicked "Stop generating") — nothing to
            // write back, and writing to an aborted response would itself throw.
            return;
        }

        using (upstreamResponse)
        {
            outgoingResponse.StatusCode = (int)upstreamResponse.StatusCode;

            foreach (var header in upstreamResponse.Headers)
            {
                if (!ExcludedResponseHeaders.Contains(header.Key))
                {
                    outgoingResponse.Headers[header.Key] = header.Value.ToArray();
                }
            }
            foreach (var header in upstreamResponse.Content.Headers)
            {
                if (!ExcludedResponseHeaders.Contains(header.Key))
                {
                    outgoingResponse.Headers[header.Key] = header.Value.ToArray();
                }
            }

            var upstreamStream = await upstreamResponse.Content.ReadAsStreamAsync(cancellationToken);
            await using (upstreamStream)
            {
                // A manual read/flush loop instead of Stream.CopyToAsync: CopyToAsync doesn't
                // guarantee a flush after every read, which would reintroduce buffering and
                // turn "token appears the instant Ollama emits it" back into "tokens arrive in
                // unpredictable bursts." Flushing after every chunk keeps the passthrough real.
                var buffer = new byte[4096];
                int bytesRead;
                try
                {
                    while ((bytesRead = await upstreamStream.ReadAsync(buffer, cancellationToken)) > 0)
                    {
                        await outgoingResponse.Body.WriteAsync(buffer.AsMemory(0, bytesRead), cancellationToken);
                        await outgoingResponse.Body.FlushAsync(cancellationToken);
                    }
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    // Client disconnected mid-stream — normal, not an error.
                }
            }
        }
    }
}
