namespace RagMiddleware.Infrastructure.Mongo;

public class MongoDbOptions
{
    public const string SectionName = "MongoDb";

    public required string ConnectionString { get; set; }
    public string DatabaseName { get; set; } = "rag_middleware";

    // The Python RAG API's own database, on the same MongoDB instance. Read-only from
    // here — this app never writes to it — used solely for the admin insights dashboard
    // (feedback/question/provider aggregates the Python side doesn't expose an API for).
    public string RagAppDatabaseName { get; set; } = "chat_project";
}
