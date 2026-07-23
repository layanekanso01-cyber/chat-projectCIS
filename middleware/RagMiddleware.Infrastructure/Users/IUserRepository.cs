using RagMiddleware.Domain;

namespace RagMiddleware.Infrastructure.Users;

public interface IUserRepository
{
    Task<User?> FindByGoogleIdAsync(string googleId, CancellationToken cancellationToken);
    Task<User?> FindByIdAsync(string id, CancellationToken cancellationToken);
    Task CreateAsync(User user, CancellationToken cancellationToken);
    Task UpdateRoleAsync(string id, string role, CancellationToken cancellationToken);
    Task UpdateProfileAsync(string id, string? displayName, string? avatarUrl, CancellationToken cancellationToken);
}
