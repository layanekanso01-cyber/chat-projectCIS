namespace RagMiddleware.Infrastructure.Mongo;

public class MongoDbOptions
{
    public const string SectionName = "MongoDb";

    public required string ConnectionString { get; set; }
    public string DatabaseName { get; set; } = "rag_middleware";
}
