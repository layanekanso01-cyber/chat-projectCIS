using RagMiddleware.Domain;

namespace RagMiddleware.Infrastructure.Auth;

public record TokenPair(string AccessToken, string RefreshToken, DateTime AccessTokenExpiresAt);

public interface IJwtTokenService
{
    string CreateAccessToken(User user);

    /// <summary>Generates a new opaque refresh token, persists its hash, and returns the
    /// raw value — the raw value is only ever seen once, at issuance.</summary>
    Task<string> CreateRefreshTokenAsync(string userId, CancellationToken cancellationToken);

    Task<TokenPair> IssueTokenPairAsync(User user, CancellationToken cancellationToken);

    /// <summary>Hashes a raw refresh token the same way it was hashed at issuance, so
    /// callers can look it up by hash without ever storing the raw value.</summary>
    string HashRefreshToken(string rawToken);
}
