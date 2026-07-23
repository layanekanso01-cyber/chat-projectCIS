using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RagMiddleware.Infrastructure.Audit;

namespace RagMiddleware.Api.Controllers;

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
    public async Task<IActionResult> Get([FromQuery] int limit, CancellationToken cancellationToken)
    {
        var effectiveLimit = limit is > 0 and <= 500 ? limit : 100;
        var entries = await _auditLogRepository.GetRecentAsync(effectiveLimit, cancellationToken);
        return Ok(entries);
    }
}
