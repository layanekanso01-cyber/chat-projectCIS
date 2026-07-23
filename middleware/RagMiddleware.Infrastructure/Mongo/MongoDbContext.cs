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

    /// <summary>Read-only access to the Python RAG API's own database — same MongoDB
    /// instance, one connection reused, but a database this app never writes to.</summary>
    public IMongoDatabase RagAppDatabase { get; }

    public MongoDbContext(IOptions<MongoDbOptions> options)
    {
        var client = new MongoClient(options.Value.ConnectionString);
        Database = client.GetDatabase(options.Value.DatabaseName);
        RagAppDatabase = client.GetDatabase(options.Value.RagAppDatabaseName);
    }
}
