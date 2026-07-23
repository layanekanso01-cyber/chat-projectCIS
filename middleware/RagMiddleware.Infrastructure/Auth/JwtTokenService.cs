using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using RagMiddleware.Domain;

namespace RagMiddleware.Infrastructure.Auth;

public class JwtTokenService : IJwtTokenService
{
    private readonly JwtOptions _options;
    private readonly IRefreshTokenRepository _refreshTokens;

    public JwtTokenService(IOptions<JwtOptions> options, IRefreshTokenRepository refreshTokens)
    {
        _options = options.Value;
        _refreshTokens = refreshTokens;
    }

    public string CreateAccessToken(User user)
    {
        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.SigningKey));
        var credentials = new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new(ClaimTypes.Role, user.Role),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
        };
        if (user.DisplayName is not null)
        {
            claims.Add(new Claim("name", user.DisplayName));
        }

        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(_options.AccessTokenMinutes),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public async Task<string> CreateRefreshTokenAsync(string userId, CancellationToken cancellationToken)
    {
        var rawToken = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));

        var refreshToken = new RefreshToken
        {
            Id = Guid.NewGuid().ToString(),
            UserId = userId,
            TokenHash = HashRefreshToken(rawToken),
            ExpiresAt = DateTime.UtcNow.AddDays(_options.RefreshTokenDays),
        };
        await _refreshTokens.CreateAsync(refreshToken, cancellationToken);

        return rawToken;
    }

    public async Task<TokenPair> IssueTokenPairAsync(User user, CancellationToken cancellationToken)
    {
        var accessToken = CreateAccessToken(user);
        var refreshToken = await CreateRefreshTokenAsync(user.Id, cancellationToken);
        var expiresAt = DateTime.UtcNow.AddMinutes(_options.AccessTokenMinutes);
        return new TokenPair(accessToken, refreshToken, expiresAt);
    }

    public string HashRefreshToken(string rawToken)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(rawToken));
        return Convert.ToHexString(bytes);
    }
}
