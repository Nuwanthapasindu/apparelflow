import { errors } from "./errors";

/**
 * CSRF defence for cookie auth, on top of SameSite=Lax. A request that carries an Origin header
 * must come from this host. A missing Origin (curl, Postman, server to server) is allowed.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin === null) return;

  const host = request.headers.get("host") ?? new URL(request.url).host;
  let originHost: string;
  try {
    originHost = new URL(origin).host; // "null" (opaque origins) and garbage throw here
  } catch {
    throw errors.csrfOrigin();
  }
  if (originHost !== host) throw errors.csrfOrigin();
}
