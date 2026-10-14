import { isProduction } from "@/lib/env";
import {
  ACCESS_COOKIE,
  ACCESS_COOKIE_PATH,
  ACCESS_TTL_SECONDS,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  REFRESH_TTL_SECONDS,
} from "./constants";

// Built by hand (no next/headers) so route handlers stay callable from Vitest.

function serialize(name: string, value: string, path: string, maxAge: number): string {
  const parts = [`${name}=${value}`, `Path=${path}`, `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Lax"];
  if (isProduction()) parts.push("Secure");
  return parts.join("; ");
}

export function sessionCookies(accessToken: string, refreshToken: string): string[] {
  return [
    serialize(ACCESS_COOKIE, accessToken, ACCESS_COOKIE_PATH, ACCESS_TTL_SECONDS),
    serialize(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_PATH, REFRESH_TTL_SECONDS),
  ];
}

/** Clearing uses the same Path as setting, otherwise the browser keeps the cookie. */
export function clearedCookies(): string[] {
  return [
    serialize(ACCESS_COOKIE, "", ACCESS_COOKIE_PATH, 0),
    serialize(REFRESH_COOKIE, "", REFRESH_COOKIE_PATH, 0),
  ];
}

/** Read one cookie from the request's Cookie header. The first occurrence wins. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}
