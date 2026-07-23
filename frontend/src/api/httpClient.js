import { MIDDLEWARE_URL } from "@/lib/config";
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from "@/lib/tokenStorage";
import { refreshAccessToken } from "@/api/auth";

let unauthorizedHandler = null;

export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

// Concurrent 401s must share a single refresh — the refresh token is
// single-use (rotated on every exchange), so two independent refresh calls
// racing each other would have the second one fail against an
// already-revoked token.
let refreshPromise = null;

function refreshTokensOnce() {
  if (!refreshPromise) {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return Promise.reject(new Error("No refresh token available"));
    refreshPromise = refreshAccessToken(refreshToken)
      .then((tokens) => {
        setTokens(tokens);
        return tokens;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/**
 * fetch() against the .NET middleware with the access token attached,
 * retrying once via refresh if the access token has expired.
 */
export async function authFetch(path, options = {}) {
  const buildHeaders = (token) => ({ ...options.headers, Authorization: `Bearer ${token}` });

  let response = await fetch(`${MIDDLEWARE_URL}${path}`, {
    ...options,
    headers: buildHeaders(getAccessToken()),
  });

  if (response.status === 401) {
    try {
      const tokens = await refreshTokensOnce();
      response = await fetch(`${MIDDLEWARE_URL}${path}`, {
        ...options,
        headers: buildHeaders(tokens.accessToken),
      });
    } catch {
      clearTokens();
      unauthorizedHandler?.();
      return response;
    }

    if (response.status === 401) {
      clearTokens();
      unauthorizedHandler?.();
    }
  }

  return response;
}
