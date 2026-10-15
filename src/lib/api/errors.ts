export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE"
  | "CSRF_ORIGIN"
  | "INTERNAL";

export type FieldErrors = Record<string, string>;
export type ErrorDetails = Record<string, unknown>;

/** An error that maps to a specific HTTP status and the standard error envelope. */
export class ApiError extends Error {
  /** Extra Set-Cookie header values to send with the error response (e.g. clearing cookies). */
  cookies: string[] = [];

  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: FieldErrors,
    readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = "ApiError";
  }

  withCookies(cookies: string[]): this {
    this.cookies = cookies;
    return this;
  }
}

export const errors = {
  unauthenticated: (message = "Authentication required") => new ApiError(401, "UNAUTHENTICATED", message),
  forbidden: (message = "You do not have permission to do that") => new ApiError(403, "FORBIDDEN", message),
  csrfOrigin: () => new ApiError(403, "CSRF_ORIGIN", "Cross-origin request rejected"),
  validation: (fields: FieldErrors = {}, message = "The request is not valid") =>
    new ApiError(400, "VALIDATION_ERROR", message, Object.keys(fields).length ? fields : undefined),
  notFound: (message = "Not found") => new ApiError(404, "NOT_FOUND", message),
  conflict: (message = "The request conflicts with the current state") => new ApiError(409, "CONFLICT", message),
  unprocessable: (message = "The request violates a business rule", details?: ErrorDetails) =>
    new ApiError(422, "UNPROCESSABLE", message, undefined, details),
  internal: () => new ApiError(500, "INTERNAL", "Something went wrong"),
};
