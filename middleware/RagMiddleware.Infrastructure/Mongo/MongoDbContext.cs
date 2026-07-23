using Microsoft.Extensions.Options;
using MongoDB.Driver;

namespace RagMiddleware.Infrastructure.Mongo;

/// <summary>
/// A separate database ("rag_middleware" by default) on the same MongoDB instance the
/// Python RAG API already uses for conversations — one less piece of infrastructure to
/// run, while keeping the middleware's own Users/AuditLog collections cleanly apart from
/// the RAG app's data.
/// </summary>
public class MongoDbContext
{
    public IMongoDatabase Database { get; }

    public MongoDbContext(IOptions<MongoDbOptions> options)
    {
        var client = new MongoClient(options.Value.ConnectionString);
        Database = client.GetDatabase(options.Value.DatabaseName);
    }
}
