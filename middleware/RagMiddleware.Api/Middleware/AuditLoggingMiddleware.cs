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
                Action = ClassifyAction(context),
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

    // A coarse, human-readable label (doc's example: "RAG_QUERY", "LOGIN_SUCCESS",
    // "LOGIN_FAILED") on top of the raw Method+Path, so the audit log can be filtered by
    // "what kind of thing happened" without knowing the exact route shape.
    private static string ClassifyAction(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";
        var status = context.Response.StatusCode;

        if (path.StartsWith("/api/auth/google/complete", StringComparison.OrdinalIgnoreCase))
        {
            return status is >= 200 and < 400 ? "LOGIN_SUCCESS" : "LOGIN_FAILED";
        }
        if (path.StartsWith("/api/auth/login/google", StringComparison.OrdinalIgnoreCase))
        {
            return "LOGIN_INITIATED";
        }
        if (path.StartsWith("/api/auth/refresh", StringComparison.OrdinalIgnoreCase))
        {
            return status == 200 ? "TOKEN_REFRESH_SUCCESS" : "TOKEN_REFRESH_FAILED";
        }
        if (path.StartsWith("/api/auth/logout", StringComparison.OrdinalIgnoreCase))
        {
            return "LOGOUT";
        }
        if (path.StartsWith("/api/admin/audit-logs", StringComparison.OrdinalIgnoreCase))
        {
            return "ADMIN_AUDIT_VIEW";
        }
        if (path.StartsWith("/api/admin/insights", StringComparison.OrdinalIgnoreCase))
        {
            return "ADMIN_INSIGHTS_VIEW";
        }
        if (path.StartsWith("/api/rag/chat", StringComparison.OrdinalIgnoreCase))
        {
            return "RAG_QUERY";
        }
        if (path.StartsWith("/api/rag/compliance-check", StringComparison.OrdinalIgnoreCase))
        {
            return "RAG_COMPLIANCE_CHECK";
        }
        if (path.StartsWith("/api/rag/", StringComparison.OrdinalIgnoreCase))
        {
            return "RAG_PROXY";
        }

        return $"{context.Request.Method}_OTHER";
    }
}
