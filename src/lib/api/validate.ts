import type { z } from "zod";
import { errors, type FieldErrors } from "./errors";

/** Parse with a Zod schema; failures become a 400 whose `fields` the UI maps onto inputs. */
export function parseWith<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  // No prototype, so keys such as "constructor" or "__proto__" are recorded like any other.
  const fields: FieldErrors = Object.create(null);
  for (const issue of result.error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) fields[key] ??= "Unknown field";
      continue;
    }
    const key = issue.path.length ? issue.path.join(".") : "_";
    fields[key] ??= issue.message;
  }
  throw errors.validation(fields);
}
