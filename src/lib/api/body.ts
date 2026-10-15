import { errors } from "./errors";

const MAX_BODY_BYTES = 16 * 1024;

async function readObject(request: Request, allowEmpty: boolean): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw errors.validation({}, "The request body is too large");

  const text = await request.text();
  if (text.trim() === "") {
    if (allowEmpty) return {};
    throw errors.validation({}, "A JSON request body is required");
  }
  if (text.length > MAX_BODY_BYTES) throw errors.validation({}, "The request body is too large");
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw errors.validation({}, "Content-Type must be application/json");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw errors.validation({}, "The request body is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw errors.validation({}, "The request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** Read a required JSON object. Empty, invalid, oversized, array or null bodies are a 400. */
export function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  return readObject(request, false);
}

/** Approve and resubmit accept either no body or a strict empty JSON object. */
export function readOptionalJsonBody(request: Request): Promise<Record<string, unknown>> {
  return readObject(request, true);
}
