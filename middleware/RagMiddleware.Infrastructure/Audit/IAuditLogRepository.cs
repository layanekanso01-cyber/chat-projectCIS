using RagMiddleware.Domain;

namespace RagMiddleware.Infrastructure.Audit;

public interface IAuditLogRepository
{
    Task InsertAsync(AuditLog entry, CancellationToken cancellationToken);
    Task<IReadOnlyList<AuditLog>> GetRecentAsync(int limit, CancellationToken cancellationToken);
}
