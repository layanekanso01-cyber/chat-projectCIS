import { MIDDLEWARE_URL } from "@/lib/config";

export function getGoogleLoginUrl() {
  return `${MIDDLEWARE_URL}/api/auth/login/google`;
}

export async function fetchCurrentUser(accessToken) {
  const response = await fetch(`${MIDDLEWARE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Auth check returned ${response.status}`);
  return response.json();
}

export async function refreshAccessToken(refreshToken) {
  const response = await fetch(`${MIDDLEWARE_URL}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) throw new Error(`Refresh returned ${response.status}`);
  const data = await response.json();
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

export async function logoutRequest(accessToken, refreshToken) {
  await fetch(`${MIDDLEWARE_URL}/api/auth/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ refreshToken }),
  });
}
