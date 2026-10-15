// Browser-side HTTP helper (axios) for the JSON API. Never imported by server code.
import axios from "axios";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/**
 * The one HTTP client for the browser. Cookies travel automatically because every call is
 * same-origin. `validateStatus` accepts every status so that this module, not axios, decides what
 * an error response means (the server always answers with the { error } envelope).
 */
export const apiClient = axios.create({ timeout: 30_000, validateStatus: () => true });

type Envelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; fields?: Record<string, string>; details?: Record<string, unknown> };
};
type Init = { method?: string; body?: unknown };

function send<T>(path: string, init: Init) {
  return apiClient.request<Envelope<T> | string>({ url: path, method: init.method ?? "GET", data: init.body });
}

const succeeded = (status: number) => status >= 200 && status < 300;

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Single-flight refresh: every caller that needs a refresh at the same moment shares one request.
 * Two parallel refreshes would present the same rotating token twice, which the server treats as
 * theft and answers by revoking the whole session family.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= apiClient
    .post("/api/auth/refresh")
    .then((res) => succeeded(res.status))
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/** Calls the API and returns `data`. On a 401 it refreshes once (POST, single-flight) and retries once. */
export async function apiFetch<T>(path: string, init: Init = {}): Promise<T> {
  let res;
  try {
    res = await send<T>(path, init);
    if (res.status === 401 && !path.startsWith("/api/auth/") && (await refreshSession())) {
      res = await send<T>(path, init);
    }
  } catch {
    // No response at all: offline, DNS failure, timeout.
    throw new ApiClientError(0, "NETWORK", "Could not reach the server");
  }

  // A proxy error page is a string, not our envelope.
  const payload: Envelope<T> | null = typeof res.data === "object" && res.data !== null ? res.data : null;
  if (!succeeded(res.status)) {
    const error = payload?.error;
    throw new ApiClientError(
      res.status,
      error?.code ?? "INTERNAL",
      error?.message ?? "Something went wrong",
      error?.fields,
      error?.details,
    );
  }
  return payload?.data as T;
}

/**
 * Navigate with a full page load instead of the client-side router. Used when the signed-in user
 * changes (sign out, role switch): a client-side navigation would leave the previous user's page
 * data in this tab's memory, and the next person at a shared terminal could read it.
 */
export function hardNavigate(path: string): void {
  window.location.assign(new URL(path, window.location.origin).toString());
}
