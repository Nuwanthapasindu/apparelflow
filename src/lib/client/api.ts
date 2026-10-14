// Browser-side fetch helper for the JSON API. Never imported by server code.

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Single-flight refresh: every caller that needs a refresh at the same moment shares one request.
 * Two parallel refreshes would present the same rotating token twice, which the server treats as
 * theft and answers by revoking the whole session family.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

async function send(path: string, init: { method?: string; body?: unknown }): Promise<Response> {
  return fetch(path, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** Calls the API and returns `data`. On a 401 it refreshes once (POST, single-flight) and retries once. */
export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res = await send(path, init);
  if (res.status === 401 && !path.startsWith("/api/auth/") && (await refreshSession())) {
    res = await send(path, init);
  }

  let payload: { data?: T; error?: { code?: string; message?: string; fields?: Record<string, string> } } | null = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const error = payload?.error;
    throw new ApiClientError(res.status, error?.code ?? "INTERNAL", error?.message ?? "Something went wrong", error?.fields);
  }
  return payload?.data as T;
}
