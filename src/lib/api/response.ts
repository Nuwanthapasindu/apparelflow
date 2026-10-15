import type { ApiError } from "./errors";

// Plain Response objects, no next/headers: handlers stay callable from Vitest.
const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

type Options = { status?: number; cookies?: string[] };

function build(body: unknown, { status = 200, cookies = [] }: Options): Response {
  const headers = new Headers(HEADERS);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

/** Success envelope: `{ "data": ... }`. */
export function ok<T>(data: T, options: Options = {}): Response {
  return build({ data }, options);
}

/** Error envelope: `{ "error": { "code", "message", "fields"?, "details"? } }`. */
export function errorResponse(error: ApiError): Response {
  return build(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
        ...(error.details ? { details: error.details } : {}),
      },
    },
    { status: error.status, cookies: error.cookies },
  );
}
