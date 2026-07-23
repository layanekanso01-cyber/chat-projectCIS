using RagMiddleware.Domain;

namespace RagMiddleware.Infrastructure.Audit;

public record AuditLogQuery(
    int Limit,
    int Offset,
    string? UserEmailContains,
    string? PathContains,
    string? Action,
    DateTime? From,
    DateTime? To);

public record AuditLogPage(IReadOnlyList<AuditLog> Items, long Total);

public interface IAuditLogRepository
{
    Task InsertAsync(AuditLog entry, CancellationToken cancellationToken);
    Task<AuditLogPage> QueryAsync(AuditLogQuery query, CancellationToken cancellationToken);
}
