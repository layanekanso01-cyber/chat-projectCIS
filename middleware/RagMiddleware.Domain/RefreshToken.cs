using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace RagMiddleware.Domain;

/// <summary>
/// The refresh token itself is never stored — only its SHA-256 hash — so a database
/// leak alone can't be used to mint new access tokens.
/// </summary>
public class RefreshToken
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public required string Id { get; set; }

    public required string UserId { get; set; }
    public required string TokenHash { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? RevokedAt { get; set; }
}
