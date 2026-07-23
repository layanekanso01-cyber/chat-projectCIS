namespace RagMiddleware.Infrastructure.RagApi;

/// <summary>
/// Bound from configuration (appsettings.json for BaseUrl, User Secrets/Key Vault for
/// ApiKey). This is the only place the RAG API's shared key exists as a typed value —
/// everything else asks for it via DI instead of reading configuration strings directly.
/// </summary>
public class RagApiOptions
{
    public const string SectionName = "RagApi";

    public required string BaseUrl { get; set; }
    public required string ApiKey { get; set; }
}
