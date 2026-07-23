using MongoDB.Driver;
using RagMiddleware.Domain;
using RagMiddleware.Infrastructure.Mongo;

namespace RagMiddleware.Infrastructure.Auth;

public class RefreshTokenRepository : IRefreshTokenRepository
{
    private readonly IMongoCollection<RefreshToken> _tokens;

    public RefreshTokenRepository(MongoDbContext context)
    {
        _tokens = context.Database.GetCollection<RefreshToken>("refresh_tokens");
    }

    public Task CreateAsync(RefreshToken token, CancellationToken cancellationToken) =>
        _tokens.InsertOneAsync(token, cancellationToken: cancellationToken);

    public async Task<RefreshToken?> FindValidByHashAsync(string tokenHash, CancellationToken cancellationToken) =>
        await _tokens
            .Find(t => t.TokenHash == tokenHash && t.RevokedAt == null && t.ExpiresAt > DateTime.UtcNow)
            .FirstOrDefaultAsync(cancellationToken);

    public Task RevokeAsync(string id, CancellationToken cancellationToken) =>
        _tokens.UpdateOneAsync(
            t => t.Id == id,
            Builders<RefreshToken>.Update.Set(t => t.RevokedAt, DateTime.UtcNow),
            cancellationToken: cancellationToken);
}
