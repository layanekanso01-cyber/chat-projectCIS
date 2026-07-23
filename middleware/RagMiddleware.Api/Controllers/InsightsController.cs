using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RagMiddleware.Infrastructure.Insights;

namespace RagMiddleware.Api.Controllers;

[ApiController]
[Authorize(Roles = "Admin")]
[Route("api/admin/insights")]
public class InsightsController : ControllerBase
{
    private readonly IInsightsRepository _insightsRepository;

    public InsightsController(IInsightsRepository insightsRepository)
    {
        _insightsRepository = insightsRepository;
    }

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        var summary = await _insightsRepository.GetSummaryAsync(cancellationToken);
        return Ok(summary);
    }
}
