using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RagMiddleware.Domain;
using RagMiddleware.Infrastructure.Auth;
using RagMiddleware.Infrastructure.Users;

namespace RagMiddleware.Api.Controllers;

public record RefreshRequest(string RefreshToken);

/// <summary>
/// Google itself only ever talks to GoogleCallback — that path is registered in Google
/// Cloud Console and MUST be handled by ASP.NET Core's own Google middleware (it does the
/// authorization-code exchange; a hand-written action can't safely reimplement that step).
/// GoogleComplete is a purely internal path, never seen by Google, where the resulting
/// cookie-based identity gets turned into a Mongo user record and our own JWT.
/// </summary>
[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly IUserRepository _users;
    private readonly IRefreshTokenRepository _refreshTokens;
    private readonly IJwtTokenService _tokenService;
    private readonly IConfiguration _configuration;

    public AuthController(
        IUserRepository users,
        IRefreshTokenRepository refreshTokens,
        IJwtTokenService tokenService,
        IConfiguration configuration)
    {
        _users = users;
        _refreshTokens = refreshTokens;
        _tokenService = tokenService;
        _configuration = configuration;
    }

    [HttpGet("login/google")]
    public IActionResult LoginGoogle()
    {
        var redirectUrl = Url.Action(nameof(GoogleComplete));
        var properties = new AuthenticationProperties { RedirectUri = redirectUrl };
        return Challenge(properties, GoogleDefaults.AuthenticationScheme);
    }

    [HttpGet("google/complete")]
    public async Task<IActionResult> GoogleComplete(CancellationToken cancellationToken)
    {
        var authenticateResult = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        if (!authenticateResult.Succeeded || authenticateResult.Principal is null)
        {
            return Unauthorized(new { detail = "Google sign-in did not complete." });
        }

        var principal = authenticateResult.Principal;
        var googleId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        var email = principal.FindFirstValue(ClaimTypes.Email);
        var name = principal.FindFirstValue(ClaimTypes.Name);
        var avatarUrl = principal.FindFirstValue("urn:google:picture");

        // The transient handshake cookie has done its job — the API itself is
        // JWT-authenticated from here on, nothing should linger.
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);

        if (googleId is null || email is null)
        {
            return Unauthorized(new { detail = "Google did not return the expected profile claims." });
        }

        var user = await _users.FindByGoogleIdAsync(googleId, cancellationToken);
        if (user is null)
        {
            user = new User
            {
                Id = Guid.NewGuid().ToString(),
                GoogleId = googleId,
                Email = email,
                DisplayName = name,
                AvatarUrl = avatarUrl,
            };
            await _users.CreateAsync(user, cancellationToken);
        }

        var tokens = await _tokenService.IssueTokenPairAsync(user, cancellationToken);

        var frontendUrl = _configuration["Frontend:BaseUrl"] ?? "http://localhost:5173";
        var redirectUrl =
            $"{frontendUrl}/auth/callback" +
            $"?access_token={Uri.EscapeDataString(tokens.AccessToken)}" +
            $"&refresh_token={Uri.EscapeDataString(tokens.RefreshToken)}";
        return Redirect(redirectUrl);
    }

    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh([FromBody] RefreshRequest request, CancellationToken cancellationToken)
    {
        var tokenHash = _tokenService.HashRefreshToken(request.RefreshToken);
        var stored = await _refreshTokens.FindValidByHashAsync(tokenHash, cancellationToken);
        if (stored is null)
        {
            return Unauthorized(new { detail = "Refresh token is invalid or has expired." });
        }

        var user = await _users.FindByIdAsync(stored.UserId, cancellationToken);
        if (user is null)
        {
            return Unauthorized();
        }

        // Rotate: the old refresh token is single-use.
        await _refreshTokens.RevokeAsync(stored.Id, cancellationToken);
        var tokens = await _tokenService.IssueTokenPairAsync(user, cancellationToken);

        return Ok(new
        {
            access_token = tokens.AccessToken,
            refresh_token = tokens.RefreshToken,
            expires_at = tokens.AccessTokenExpiresAt,
        });
    }

    [Authorize]
    [HttpGet("me")]
    public IActionResult Me()
    {
        return Ok(new
        {
            id = User.FindFirstValue(JwtRegisteredClaimNames.Sub),
            email = User.FindFirstValue(JwtRegisteredClaimNames.Email),
            name = User.FindFirstValue("name"),
            role = User.FindFirstValue(ClaimTypes.Role),
        });
    }

    [Authorize]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout([FromBody] RefreshRequest request, CancellationToken cancellationToken)
    {
        var tokenHash = _tokenService.HashRefreshToken(request.RefreshToken);
        var stored = await _refreshTokens.FindValidByHashAsync(tokenHash, cancellationToken);
        if (stored is not null)
        {
            await _refreshTokens.RevokeAsync(stored.Id, cancellationToken);
        }
        return NoContent();
    }
}
