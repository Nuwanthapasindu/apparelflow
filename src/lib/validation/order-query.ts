import { OrderStatus } from "@/generated/prisma/enums";
import { errors } from "@/lib/api/errors";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export type ListOrdersQuery = { status?: OrderStatus; limit: number };

/** Strict parsing of ?status= and ?limit=. Repeated or malformed values are a 400 with `fields`. */
export function parseListOrdersQuery(params: URLSearchParams): ListOrdersQuery {
  const fields: Record<string, string> = {};
  const query: ListOrdersQuery = { limit: DEFAULT_LIMIT };

  const status = params.getAll("status");
  if (status.length > 1) fields.status = "Give status once";
  else if (status.length === 1) {
    if ((Object.values(OrderStatus) as string[]).includes(status[0])) query.status = status[0] as OrderStatus;
    else fields.status = "Unknown status";
  }

  const limit = params.getAll("limit");
  if (limit.length > 1) fields.limit = "Give limit once";
  else if (limit.length === 1) {
    const n = /^[1-9]\d{0,3}$/.test(limit[0]) ? Number(limit[0]) : NaN;
    if (n >= 1 && n <= MAX_LIMIT) query.limit = n;
    else fields.limit = `Limit must be a whole number from 1 to ${MAX_LIMIT}`;
  }

  if (Object.keys(fields).length) throw errors.validation(fields);
  return query;
}
