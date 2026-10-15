import { errors } from "@/lib/api/errors";
import { DEFAULT_LIMIT, MAX_LIMIT } from "./order-query";

export type SewingListQuery = { limit: number };

/**
 * The only query parameter the sewing lists read is `limit`. Every other parameter (`status`,
 * `all`, `id`, `where`, ...) is ignored and never reaches a query: the status filter of each list
 * is a constant in its service function, so URL tampering cannot widen what a sewing user sees.
 */
export function parseSewingListQuery(params: URLSearchParams): SewingListQuery {
  const limit = params.getAll("limit");
  if (limit.length === 0) return { limit: DEFAULT_LIMIT };
  if (limit.length > 1) throw errors.validation({ limit: "Give limit once" });
  const n = /^[1-9]\d{0,3}$/.test(limit[0]) ? Number(limit[0]) : NaN;
  if (!(n >= 1 && n <= MAX_LIMIT)) throw errors.validation({ limit: `Limit must be a whole number from 1 to ${MAX_LIMIT}` });
  return { limit: n };
}
