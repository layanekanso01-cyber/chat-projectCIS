using RagMiddleware.Domain;

namespace RagMiddleware.Infrastructure.Auth;

public interface IRefreshTokenRepository
{
    Task CreateAsync(RefreshToken token, CancellationToken cancellationToken);
    Task<RefreshToken?> FindValidByHashAsync(string tokenHash, CancellationToken cancellationToken);
    Task RevokeAsync(string id, CancellationToken cancellationToken);
}
