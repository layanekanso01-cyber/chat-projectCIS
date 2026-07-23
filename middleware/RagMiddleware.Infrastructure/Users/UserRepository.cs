using MongoDB.Driver;
using RagMiddleware.Domain;
using RagMiddleware.Infrastructure.Mongo;

namespace RagMiddleware.Infrastructure.Users;

public class UserRepository : IUserRepository
{
    private readonly IMongoCollection<User> _users;

    public UserRepository(MongoDbContext context)
    {
        _users = context.Database.GetCollection<User>("users");
    }

    public async Task<User?> FindByGoogleIdAsync(string googleId, CancellationToken cancellationToken) =>
        await _users.Find(u => u.GoogleId == googleId).FirstOrDefaultAsync(cancellationToken);

    public async Task<User?> FindByIdAsync(string id, CancellationToken cancellationToken) =>
        await _users.Find(u => u.Id == id).FirstOrDefaultAsync(cancellationToken);

    public Task CreateAsync(User user, CancellationToken cancellationToken) =>
        _users.InsertOneAsync(user, cancellationToken: cancellationToken);
}
