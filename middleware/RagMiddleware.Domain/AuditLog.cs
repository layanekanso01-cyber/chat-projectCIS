using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace RagMiddleware.Domain;

public class AuditLog
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public required string Id { get; set; }

    public string? UserId { get; set; }
    public string? UserEmail { get; set; }
    public required string Action { get; set; }
    public required string Method { get; set; }
    public required string Path { get; set; }
    public string? QueryString { get; set; }
    public int StatusCode { get; set; }
    public long DurationMs { get; set; }
    public string? IpAddress { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}
