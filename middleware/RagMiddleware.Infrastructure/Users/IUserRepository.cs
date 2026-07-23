using RagMiddleware.Domain;

namespace RagMiddleware.Infrastructure.Users;

public interface IUserRepository
{
    Task<User?> FindByGoogleIdAsync(string googleId, CancellationToken cancellationToken);
    Task<User?> FindByIdAsync(string id, CancellationToken cancellationToken);
    Task CreateAsync(User user, CancellationToken cancellationToken);
}
