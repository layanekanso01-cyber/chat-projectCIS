namespace RagMiddleware.Infrastructure.Auth;

public class JwtOptions
{
    public const string SectionName = "Jwt";

    public required string SigningKey { get; set; }
    public string Issuer { get; set; } = "RagMiddleware";
    public string Audience { get; set; } = "RagMiddleware.Client";
    public int AccessTokenMinutes { get; set; } = 30;
    public int RefreshTokenDays { get; set; } = 14;
}
