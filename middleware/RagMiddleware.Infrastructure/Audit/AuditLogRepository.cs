using System.Text.RegularExpressions;
using MongoDB.Bson;
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

    public async Task<AuditLogPage> QueryAsync(AuditLogQuery query, CancellationToken cancellationToken)
    {
        var filters = new List<FilterDefinition<AuditLog>>();

        if (!string.IsNullOrWhiteSpace(query.UserEmailContains))
        {
            var pattern = new BsonRegularExpression(Regex.Escape(query.UserEmailContains), "i");
            filters.Add(Builders<AuditLog>.Filter.Regex(e => e.UserEmail, pattern));
        }
        if (!string.IsNullOrWhiteSpace(query.PathContains))
        {
            var pattern = new BsonRegularExpression(Regex.Escape(query.PathContains), "i");
            filters.Add(Builders<AuditLog>.Filter.Regex(e => e.Path, pattern));
        }
        if (!string.IsNullOrWhiteSpace(query.Action))
        {
            filters.Add(Builders<AuditLog>.Filter.Eq(e => e.Action, query.Action));
        }
        if (query.From is not null)
        {
            filters.Add(Builders<AuditLog>.Filter.Gte(e => e.Timestamp, query.From.Value));
        }
        if (query.To is not null)
        {
            filters.Add(Builders<AuditLog>.Filter.Lte(e => e.Timestamp, query.To.Value));
        }

        var filter = filters.Count > 0
            ? Builders<AuditLog>.Filter.And(filters)
            : FilterDefinition<AuditLog>.Empty;

        var total = await _auditLogs.CountDocumentsAsync(filter, cancellationToken: cancellationToken);
        var items = await _auditLogs
            .Find(filter)
            .SortByDescending(entry => entry.Timestamp)
            .Skip(query.Offset)
            .Limit(query.Limit)
            .ToListAsync(cancellationToken);

        return new AuditLogPage(items, total);
    }
}
