import { mapDbError } from "@/lib/db-errors";
import { ApiError, errors } from "./errors";
import { assertSameOrigin } from "./origin";
import { errorResponse } from "./response";

type Handler<C> = (request: Request, context: C) => Promise<Response>;

// Next.js uses thrown errors with a string `digest` as control flow (redirect, notFound, "this
// route is dynamic" during prerender). They are not failures and must reach the framework.
const isNextSignal = (error: unknown) => typeof (error as { digest?: unknown } | null)?.digest === "string";

/**
 * Wrap a route handler: converts anything thrown into the standard error envelope.
 * `mutating: true` runs the Origin check first, before authentication or parsing.
 */
export function handle<C = unknown>(handler: Handler<C>, options: { mutating?: boolean } = {}): Handler<C> {
  return async (request, context) => {
    try {
      if (options.mutating) assertSameOrigin(request);
      return await handler(request, context);
    } catch (error) {
      if (isNextSignal(error)) throw error;
      if (error instanceof ApiError) return errorResponse(error);
      const mapped = mapDbError(error);
      if (mapped) {
        if (mapped.status >= 500) {
          const e = error as { name?: string; code?: string } | null;
          console.error("[api] mapped internal database error", { name: e?.name, code: e?.code });
        }
        return errorResponse(mapped);
      }

      // Log the type only: error messages can carry SQL text or user input.
      const e = error as { name?: string; code?: string } | null;
      console.error("[api] unhandled error", { name: e?.name, code: e?.code });
      return errorResponse(errors.internal());
    }
  };
}
