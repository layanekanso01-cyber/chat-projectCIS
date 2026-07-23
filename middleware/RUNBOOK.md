# Runbook

Operational procedures for RagMiddleware. See `README.md` for architecture, setup, and
the endpoint reference.

## The Python RAG API is down / unreachable

**Symptom:** every `/api/rag/*` call returns `502 Bad Gateway` with
`{"detail": "Could not reach the RAG API."}`. Login, `/api/auth/me`, and
`/api/admin/audit-logs` keep working — they don't depend on the Python API at all.

1. Confirm it's actually down: `curl http://127.0.0.1:8000/health` (or whatever
   `RagApi:BaseUrl` is set to). `/health` is the one Python route that doesn't require the
   shared middleware key.
2. Check its own dependencies are up — Weaviate (`localhost:8080`) and, for generation,
   Ollama (`ollama serve`) — per the repo root `CLAUDE.md`. The Python API can be "up" as a
   process while still failing every real request if either of those is down.
3. Once it's back, no restart of RagMiddleware is needed — `RagApiClient` doesn't cache a
   connection or a health state, so the very next proxied request just works again. The
   Polly retry policy (2 retries, exponential backoff, connect+headers phase only) already
   absorbs brief blips before a 502 is even returned to the UI.
4. To see how long the outage lasted / how many requests were affected, filter the audit
   log for `path` containing `/api/rag` — 502 rows show the outage window directly
   (`GET /api/admin/audit-logs?path=/api/rag&from=...`).

## Rotating the shared RAG API credential (`RagApi:ApiKey` / `MIDDLEWARE_SHARED_KEY`)

This is the value that lets RagMiddleware talk to the Python API; rotate it if it may have
leaked (e.g. committed by accident, printed in a log, shared over an insecure channel).

1. Generate a new random value (e.g. `openssl rand -hex 32`, or anything long and random —
   it's an opaque shared secret, not a signed token, so format doesn't matter).
2. Update it in **both** places at once — they must match, and there's a window where
   they won't while you update them:
   ```bash
   # .NET side
   cd RagMiddleware.Api
   dotnet user-secrets set "RagApi:ApiKey" "<new value>"

   # Python side — backend/.env
   MIDDLEWARE_SHARED_KEY=<same new value>
   ```
3. Restart both processes (`dotnet run` picks up user-secrets on startup; `uvicorn --reload`
   picks up `.env` changes on its own restart, or restart it manually if it doesn't).
4. Old value stops working immediately once the Python process restarts — there's no
   overlap/grace period by design (`require_middleware_key` does an exact string match).
   If this is a live system, this means the RAG API is unreachable through the middleware
   for however long the restart window is — coordinate the two restarts to minimize it.
5. In a real deployment, this value would live in Key Vault/environment variables instead
   (see README → "Secret storage") — rotation there is "update the secret, redeploy/restart
   the two services," same shape as above.

## Revoking a compromised Google OAuth client secret

1. In Google Cloud Console → APIs & Services → Credentials, open the OAuth 2.0 Client ID
   used by this app and reset/regenerate its client secret (or delete and recreate the
   credential entirely if the Client ID itself is also considered compromised).
2. Update the new secret in user-secrets:
   ```bash
   dotnet user-secrets set "Authentication:Google:ClientSecret" "<new value>"
   ```
   (If the Client ID also changed, update `Authentication:Google:ClientId` too, and
   re-register the redirect URI on the new credential.)
3. Restart RagMiddleware. The old secret stops being accepted by Google immediately on
   regeneration — any in-flight login attempt started before rotation will fail at the
   token-exchange step and the user just retries "Sign in with Google."
4. This does **not** invalidate JWTs or refresh tokens already issued to existing users —
   those are signed with `Jwt:SigningKey`, entirely independent of the Google credential.
   Existing sessions are unaffected; only *new* Google sign-ins are gated on the rotated
   secret.
5. If the compromise is severe enough that existing sessions must also be killed, that's a
   `Jwt:SigningKey` rotation instead: changing it invalidates every access token
   instantly (signature no longer validates), and every refresh token stops working too
   since `POST /api/auth/refresh` issues new access tokens signed with whatever key is
   currently configured — there's no way to "target" specific sessions, it's all-or-nothing.
