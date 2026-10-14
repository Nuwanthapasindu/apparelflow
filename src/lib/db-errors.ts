import { ApiError, errors } from "@/lib/api/errors";

// Custom SQLSTATEs raised by the Day 1 guard triggers:
//   GK403 wrong role, GK409 illegal state, GK422 hard stop (business rule).

const SQLSTATE = /^[0-9A-Z]{5}$/;

/** The Postgres SQLSTATE behind a Prisma error, if there is one. */
export function sqlStateOf(error: unknown): string | undefined {
  const e = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown } | null | undefined;
  if (typeof e?.meta?.code === "string" && SQLSTATE.test(e.meta.code)) return e.meta.code;
  if (typeof e?.message === "string") {
    // Raw queries: "Raw query failed. Code: `GK409`. Message: ..."
    // Typed client (PrismaClientUnknownRequestError): "... PostgresError { code: \"GK409\", message: ..."
    const match = /Code: `([0-9A-Z]{5})`/.exec(e.message) ?? /PostgresError \{ code: "([0-9A-Z]{5})"/.exec(e.message);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Translate a database error into a clean API error, or null when it is not one we know.
 * Messages are deliberately generic: never return SQL text, constraint names or row values.
 */
export function mapDbError(error: unknown): ApiError | null {
  const prismaCode = (error as { code?: unknown } | null | undefined)?.code;
  const state = sqlStateOf(error);

  if (state === "GK403") return errors.forbidden("That action is not permitted for this user");
  if (state === "GK409") return errors.conflict("The request conflicts with the current state");
  if (state === "GK422") return errors.unprocessable("The request violates a business rule");
  if (state === "23505" || prismaCode === "P2002") return errors.conflict("A conflicting record already exists");
  if (state === "23514") return errors.validation({}, "The submitted values are not valid");
  return null;
}
