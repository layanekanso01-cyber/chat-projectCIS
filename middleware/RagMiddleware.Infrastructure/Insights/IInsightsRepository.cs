namespace RagMiddleware.Infrastructure.Insights;

public interface IInsightsRepository
{
    Task<InsightsSummary> GetSummaryAsync(CancellationToken cancellationToken);
}
