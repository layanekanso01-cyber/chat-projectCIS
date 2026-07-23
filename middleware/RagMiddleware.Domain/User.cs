using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace RagMiddleware.Domain;

public class User
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public required string Id { get; set; }

    /// <summary>Google's "sub" claim — the stable, unique identifier for this Google account.</summary>
    public required string GoogleId { get; set; }

    public required string Email { get; set; }
    public string? DisplayName { get; set; }
    public string? AvatarUrl { get; set; }

    /// <summary>"User" or "Admin" — Admin gates access to GET /api/admin/audit-logs.</summary>
    public string Role { get; set; } = "User";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
