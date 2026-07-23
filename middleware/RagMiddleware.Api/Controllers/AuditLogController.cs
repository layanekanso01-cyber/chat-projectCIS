using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RagMiddleware.Infrastructure.Audit;

namespace RagMiddleware.Api.Controllers;

public record AuditLogQueryRequest(
    int? Limit,
    int? Offset,
    string? UserEmail,
    string? Path,
    string? Action,
    DateTime? From,
    DateTime? To);

[ApiController]
[Authorize(Roles = "Admin")]
[Route("api/admin/audit-logs")]
public class AuditLogController : ControllerBase
{
    private readonly IAuditLogRepository _auditLogRepository;

    public AuditLogController(IAuditLogRepository auditLogRepository)
    {
        _auditLogRepository = auditLogRepository;
    }

    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] AuditLogQueryRequest request, CancellationToken cancellationToken)
    {
        var limit = request.Limit is > 0 and <= 500 ? request.Limit.Value : 100;
        var offset = request.Offset is > 0 ? request.Offset.Value : 0;

        // Mongo's DateTime serializer requires Kind == Utc (same reason AuditLog.Timestamp
        // is always written via DateTime.UtcNow) — query-string dates come back as
        // Unspecified from model binding, so treat them as UTC explicitly rather than let
        // that throw the first time someone actually uses the date filter.
        var from = request.From is { } f ? DateTime.SpecifyKind(f, DateTimeKind.Utc) : (DateTime?)null;
        var to = request.To is { } t ? DateTime.SpecifyKind(t, DateTimeKind.Utc) : (DateTime?)null;

        var page = await _auditLogRepository.QueryAsync(
            new AuditLogQuery(limit, offset, request.UserEmail, request.Path, request.Action, from, to),
            cancellationToken);

        return Ok(new { items = page.Items, total = page.Total, limit, offset });
    }
}
