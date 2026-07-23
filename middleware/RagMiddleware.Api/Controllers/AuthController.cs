using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
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
[EnableRateLimiting("auth")]
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

        // Admin isn't a self-service signup choice — it's granted by listing an email in
        // config (Admin:Emails), checked on every login so promoting someone just means
        // adding their email and having them sign in again.
        var adminEmails = _configuration.GetSection("Admin:Emails").Get<string[]>() ?? [];
        var isAdminEmail = adminEmails.Contains(email, StringComparer.OrdinalIgnoreCase);

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
                Role = isAdminEmail ? "Admin" : "User",
            };
            await _users.CreateAsync(user, cancellationToken);
        }
        else
        {
            if (isAdminEmail && user.Role != "Admin")
            {
                await _users.UpdateRoleAsync(user.Id, "Admin", cancellationToken);
                user.Role = "Admin";
            }

            // Google's display name/picture can change after the account was first
            // created here — sync them on every login rather than freezing whatever was
            // captured at signup.
            if (user.DisplayName != name || user.AvatarUrl != avatarUrl)
            {
                await _users.UpdateProfileAsync(user.Id, name, avatarUrl, cancellationToken);
                user.DisplayName = name;
                user.AvatarUrl = avatarUrl;
            }
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
        if (string.IsNullOrWhiteSpace(request.RefreshToken))
        {
            return BadRequest(new { detail = "refreshToken is required." });
        }

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
            avatarUrl = User.FindFirstValue("avatar"),
            role = User.FindFirstValue(ClaimTypes.Role),
        });
    }

    [Authorize]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout([FromBody] RefreshRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.RefreshToken))
        {
            return NoContent();
        }

        var tokenHash = _tokenService.HashRefreshToken(request.RefreshToken);
        var stored = await _refreshTokens.FindValidByHashAsync(tokenHash, cancellationToken);
        if (stored is not null)
        {
            await _refreshTokens.RevokeAsync(stored.Id, cancellationToken);
        }
        return NoContent();
    }
}
