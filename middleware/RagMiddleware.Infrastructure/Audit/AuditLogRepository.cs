using MongoDB.Driver;
using RagMiddleware.Domain;
using RagMiddleware.Infrastructure.Mongo;

namespace RagMiddleware.Infrastructure.Audit;

public class AuditLogRepository : IAuditLogRepository
{
    private readonly IMongoCollection<AuditLog> _auditLogs;

    public AuditLogRepository(MongoDbContext context)
    {
        _auditLogs = context.Database.GetCollection<AuditLog>("audit_logs");
    }

    public Task InsertAsync(AuditLog entry, CancellationToken cancellationToken) =>
        _auditLogs.InsertOneAsync(entry, cancellationToken: cancellationToken);

    public async Task<IReadOnlyList<AuditLog>> GetRecentAsync(int limit, CancellationToken cancellationToken) =>
        await _auditLogs
            .Find(FilterDefinition<AuditLog>.Empty)
            .SortByDescending(entry => entry.Timestamp)
            .Limit(limit)
            .ToListAsync(cancellationToken);
}
