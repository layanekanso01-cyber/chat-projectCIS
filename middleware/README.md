# RagMiddleware

A .NET 9 API that sits between the React frontend and the Python RAG API. It owns Google
OAuth login, issues its own JWT session tokens, reverse-proxies every `/api/rag/*` call to
the Python backend (attaching the shared credential the browser never sees), and keeps an
audit log of every request it handles.

```
frontend (5173)  →  RagMiddleware.Api (5292)  →  Python RAG API (8000)
                          │
                          └── MongoDB (rag_middleware database)
```

## Projects

- **RagMiddleware.Api** — controllers, `Program.cs` (pipeline/DI wiring), the audit
  logging middleware.
- **RagMiddleware.Domain** — `User`, `RefreshToken`, `AuditLog` entities. No dependencies
  beyond `MongoDB.Bson`.
- **RagMiddleware.Infrastructure** — Mongo repositories, JWT issuance, the RAG API reverse
  proxy client.
- **RagMiddleware.Application** — reserved for business logic that doesn't belong in a
  controller or a repository; currently empty.

## Prerequisites

- .NET 9 SDK
- MongoDB running locally (same instance the Python backend uses — this app just adds a
  separate `rag_middleware` database on it)
- The Python RAG API running (see the repo root `CLAUDE.md`) — the proxy has nothing to
  proxy to otherwise
- A Google OAuth 2.0 Client ID (Web application type), with an authorized redirect URI of
  `http://localhost:5292/api/auth/google/callback` for local dev

## Configuration

`appsettings.json` holds structural placeholders only — every actual value is local-only
secret data and belongs in .NET user-secrets, never committed. From
`RagMiddleware.Api/`:

```bash
dotnet user-secrets set "RagApi:BaseUrl" "http://127.0.0.1:8000"
dotnet user-secrets set "RagApi:ApiKey" "<same value as the Python backend's MIDDLEWARE_SHARED_KEY>"
dotnet user-secrets set "MongoDb:ConnectionString" "mongodb://localhost:27017"
dotnet user-secrets set "Jwt:SigningKey" "<any long random string>"
dotnet user-secrets set "Authentication:Google:ClientId" "<from Google Cloud Console>"
dotnet user-secrets set "Authentication:Google:ClientSecret" "<from Google Cloud Console>"
```

Optional — promotes an account to the `Admin` role (unlocks `GET /api/admin/audit-logs`)
on its next login:

```bash
dotnet user-secrets set "Admin:Emails:0" "you@example.com"
```

The Python side needs the matching half of the shared secret — `MIDDLEWARE_SHARED_KEY` in
`backend/.env`, equal to whatever was set above for `RagApi:ApiKey`. Every Python route
except `/health` rejects requests that don't carry it, so the Python API is unreachable by
anything other than this middleware.

## Running

```bash
cd RagMiddleware.Api
dotnet run --launch-profile http
```

Runs on `http://localhost:5292`. Interactive docs (dev only) at `/scalar/v1`.

## Auth flow

1. Frontend sends the browser to `GET /api/auth/login/google`.
2. ASP.NET Core's Google middleware handles the OAuth handshake at
   `/api/auth/google/callback` (this exact path is registered with Google and must stay
   untouched — it's framework-owned, not a controller action).
3. `GET /api/auth/google/complete` (internal only, never seen by Google) reads the
   resulting identity, finds-or-creates the Mongo `User`, checks `Admin:Emails` for role
   promotion, and redirects to `{Frontend:BaseUrl}/auth/callback?access_token=...&refresh_token=...`.
4. The access token (30 min default) authenticates everything else via
   `Authorization: Bearer`. The refresh token (14 days default) is single-use — every
   `POST /api/auth/refresh` call rotates it, storing only a SHA-256 hash in Mongo.

## Endpoints

| Route | Auth | Notes |
|---|---|---|
| `GET /health` | none | |
| `GET /api/auth/login/google` | none | redirects to Google |
| `GET /api/auth/google/complete` | cookie (internal) | never call directly |
| `POST /api/auth/refresh` | none (token in body) | rotates the refresh token |
| `GET /api/auth/me` | JWT | |
| `POST /api/auth/logout` | JWT | revokes the given refresh token |
| `GET\|POST\|PATCH\|DELETE /api/rag/{**path}` | JWT | reverse proxy to the Python API |
| `GET /api/admin/audit-logs?limit=` | JWT, `Admin` role | |

## Hardening notes

- **CORS**: locked to `http://localhost:5173`/`5174`, with an explicit method/header
  allow-list (no `AllowAnyOrigin`/`AllowAnyHeader`/`AllowAnyMethod`).
- **Rate limiting**: `auth` policy (login/refresh/logout) — 10 requests/minute per IP.
  `api` policy (the RAG proxy) — 120/minute per IP. Both are fixed-window and partitioned
  by client IP; a long-running SSE stream (e.g. the compliance checklist) only ever
  consumes one permit for the whole request.
- **Audit logging middleware is registered before `UseAuthentication`/`UseRateLimiter`**,
  not after — both of those short-circuit the pipeline on rejection, so a logging
  middleware placed after either would never see the 401s/429s that are usually the most
  worth auditing. This was a real bug caught during testing, not a hypothetical.
- **HSTS** is enabled outside `Development`.
- The refresh token is never stored raw — only its SHA-256 hash. The `X-Middleware-Key`
  shared secret is attached to outbound proxy requests only, and explicitly stripped from
  every response before it reaches the browser.

## Troubleshooting

- **`MSB3021`/`MSB3027` "cannot copy .exe, locked by process"** on rebuild — a previous
  `dotnet run` is still holding the port. Find and stop it first:
  ```powershell
  Get-NetTCPConnection -LocalPort 5292 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  ```
- **`/api/auth/login/google` redirects but login never completes** — check the redirect
  URI registered in Google Cloud Console matches exactly, including the port from
  whichever launch profile you're using (`http` = 5292 by default here).
- **A protected endpoint redirects to Google instead of returning 401** — something set
  `DefaultChallengeScheme` to Google in `AddAuthentication()`. It must stay on
  `JwtBearerDefaults.AuthenticationScheme`; only `AuthController.LoginGoogle()`'s explicit
  `Challenge(..., GoogleDefaults.AuthenticationScheme)` call should ever trigger a Google
  redirect.
