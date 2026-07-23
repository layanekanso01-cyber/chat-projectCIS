using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Polly;
using Polly.Extensions.Http;
using RagMiddleware.Infrastructure.Auth;
using RagMiddleware.Infrastructure.Mongo;
using RagMiddleware.Infrastructure.RagApi;
using RagMiddleware.Infrastructure.Users;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers();
builder.Services.AddOpenApi();

// Strongly-typed, validated config for the one credential this app holds on the RAG API's
// behalf — no scattered Configuration["Key"] string lookups.
builder.Services
    .AddOptions<RagApiOptions>()
    .Bind(builder.Configuration.GetSection(RagApiOptions.SectionName))
    .ValidateDataAnnotations()
    .Validate(o => !string.IsNullOrWhiteSpace(o.BaseUrl), "RagApi:BaseUrl is not configured.")
    .Validate(o => !string.IsNullOrWhiteSpace(o.ApiKey), "RagApi:ApiKey is not configured.")
    .ValidateOnStart();

builder.Services.AddHttpClient<IRagApiClient, RagApiClient>((sp, client) =>
{
    var options = sp.GetRequiredService<IOptions<RagApiOptions>>().Value;
    client.BaseAddress = new Uri(options.BaseUrl);
    // SSE streams (the compliance checklist especially, ~1-4 minutes for 18 sequential
    // model calls) can run well past HttpClient's default 100s timeout — that default
    // would kill a legitimate in-progress stream, not just a genuinely hung request.
    client.Timeout = Timeout.InfiniteTimeSpan;
})
.AddTransientHttpErrorPolicy(policy => policy.WaitAndRetryAsync(
    2, retryAttempt => TimeSpan.FromMilliseconds(200 * Math.Pow(2, retryAttempt))));
// Retries only ever apply to the connect+response-headers phase (that's the SendAsync
// call Polly wraps) — once a stream has started flowing to the browser, a mid-stream
// failure surfaces as-is rather than silently retrying and duplicating output.

// --- MongoDB (Users, RefreshTokens — the middleware's own data, separate from the RAG
// app's own MongoDB database) ---
builder.Services
    .AddOptions<MongoDbOptions>()
    .Bind(builder.Configuration.GetSection(MongoDbOptions.SectionName))
    .Validate(o => !string.IsNullOrWhiteSpace(o.ConnectionString), "MongoDb:ConnectionString is not configured.")
    .ValidateOnStart();
builder.Services.AddSingleton<MongoDbContext>();
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IRefreshTokenRepository, RefreshTokenRepository>();

// --- JWT issuance (our own session tokens, handed to the UI after Google sign-in) ---
builder.Services
    .AddOptions<JwtOptions>()
    .Bind(builder.Configuration.GetSection(JwtOptions.SectionName))
    .Validate(o => !string.IsNullOrWhiteSpace(o.SigningKey), "Jwt:SigningKey is not configured.")
    .ValidateOnStart();
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();

// --- Authentication: Google is only ever used for the brief login handshake (backed by
// a short-lived cookie); every other request to the API is authenticated via the JWT we
// issue ourselves once that handshake completes. ---
var jwtOptions = builder.Configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>()
    ?? throw new InvalidOperationException("Jwt configuration section is missing.");

builder.Services.AddAuthentication(options =>
{
    // [Authorize] failures anywhere in the app (RagProxyController, /api/auth/me, etc.)
    // must return a clean 401, not redirect to Google — so JwtBearer is the default for
    // both authenticate AND challenge. The one place that *should* redirect to Google
    // (AuthController.LoginGoogle) does so via an explicit Challenge(..., GoogleDefaults
    // .AuthenticationScheme) call, which doesn't depend on this default at all.
    options.DefaultScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultSignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
})
.AddCookie(options =>
{
    options.Cookie.Name = "RagMiddleware.OAuthHandshake";
    options.ExpireTimeSpan = TimeSpan.FromMinutes(10);
})
.AddGoogle(options =>
{
    options.ClientId = builder.Configuration["Authentication:Google:ClientId"]
        ?? throw new InvalidOperationException("Authentication:Google:ClientId is not configured.");
    options.ClientSecret = builder.Configuration["Authentication:Google:ClientSecret"]
        ?? throw new InvalidOperationException("Authentication:Google:ClientSecret is not configured.");
    // Must match exactly what's registered in Google Cloud Console for this app.
    options.CallbackPath = "/api/auth/google/callback";
    options.SignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    // Without this, the handler silently renames "sub"/"email" to the long legacy
    // ClaimTypes.NameIdentifier/Email URIs on validation (its default behavior), which
    // breaks every FindFirstValue(JwtRegisteredClaimNames.Sub/.Email) lookup elsewhere in
    // this app — those short names are exactly what JwtTokenService.CreateAccessToken
    // issues, so keeping claim types unmapped keeps issuance and reads symmetric.
    options.MapInboundClaims = false;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidIssuer = jwtOptions.Issuer,
        ValidateAudience = true,
        ValidAudience = jwtOptions.Audience,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.SigningKey)),
    };
});

builder.Services.AddAuthorization();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

app.UseHttpsRedirection();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();
