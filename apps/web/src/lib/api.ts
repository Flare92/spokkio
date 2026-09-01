const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api/v1";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("spokkio_token");
}

export function setToken(token: string) {
  window.localStorage.setItem("spokkio_token", token);
}

export function clearToken() {
  window.localStorage.removeItem("spokkio_token");
}

function decodeTokenPayload(): { teamId: string; sub: string } | null {
  const token = getToken();
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
}

export function decodeTeamId(): string | null {
  return decodeTokenPayload()?.teamId ?? null;
}

export function decodeUserId(): string | null {
  return decodeTokenPayload()?.sub ?? null;
}

// Thin fetch wrapper that mirrors the tool-call shape used by every backend
// endpoint (POST, JSON body validated against the same @spokkio/shared
// schema server-side) — the UI is a caller of the same tools an MCP layer
// will expose later, nothing more.
export async function callTool<TOutput = unknown>(path: string, body: unknown): Promise<TOutput> {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(errorBody.message ?? `Request to ${path} failed with status ${res.status}`);
  }

  return res.json();
}
