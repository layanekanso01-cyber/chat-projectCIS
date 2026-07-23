using Microsoft.Extensions.Options;
using Polly;
using Polly.Extensions.Http;
using RagMiddleware.Infrastructure.RagApi;
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

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

app.UseHttpsRedirection();

app.MapControllers();

app.Run();
