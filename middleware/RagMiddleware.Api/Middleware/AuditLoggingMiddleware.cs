using System.Diagnostics;
using System.IdentityModel.Tokens.Jwt;
using RagMiddleware.Domain;
using RagMiddleware.Infrastructure.Audit;

namespace RagMiddleware.Api.Middleware;

/// <summary>
/// Records one row per request that reaches the app — who (if anyone was authenticated),
/// what, and the outcome. Registered BEFORE UseAuthentication/UseAuthorization so it wraps
/// them: by the time its finally block runs, the downstream pipeline (including auth) has
/// already completed, so HttpContext.User and the real response status code are both
/// populated — including for requests authorization itself rejected with a 401, which
/// never reach a middleware registered after UseAuthorization.
/// </summary>
public class AuditLoggingMiddleware
{
    private static readonly string[] ExcludedPathPrefixes = ["/health", "/openapi", "/scalar"];

    private readonly RequestDelegate _next;

    public AuditLoggingMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, IAuditLogRepository auditLogRepository)
    {
        if (context.Request.Method == HttpMethods.Options ||
            ExcludedPathPrefixes.Any(prefix => context.Request.Path.StartsWithSegments(prefix)))
        {
            await _next(context);
            return;
        }

        var stopwatch = Stopwatch.StartNew();
        try
        {
            await _next(context);
        }
        finally
        {
            stopwatch.Stop();

            var entry = new AuditLog
            {
                Id = Guid.NewGuid().ToString(),
                UserId = context.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value,
                UserEmail = context.User.FindFirst(JwtRegisteredClaimNames.Email)?.Value,
                Method = context.Request.Method,
                Path = context.Request.Path.Value ?? "",
                QueryString = context.Request.QueryString.HasValue ? context.Request.QueryString.Value : null,
                StatusCode = context.Response.StatusCode,
                DurationMs = stopwatch.ElapsedMilliseconds,
                IpAddress = context.Connection.RemoteIpAddress?.ToString(),
            };

            try
            {
                // CancellationToken.None, not context.RequestAborted: a client-aborted
                // stream (e.g. the "stop generating" button) already has its token
                // cancelled by this point, which would otherwise silently skip logging
                // exactly the requests it's most useful to have a record of.
                await auditLogRepository.InsertAsync(entry, CancellationToken.None);
            }
            catch
            {
                // A missed audit row must never take down the actual request it's
                // describing — the request has already been fully handled above.
            }
        }
    }
}
