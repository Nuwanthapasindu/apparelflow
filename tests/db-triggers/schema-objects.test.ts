import { describe, expect, it } from "vitest";
import { prisma } from "../helpers/db";

describe("migrated schema objects", () => {
  it("has the six guard triggers", async () => {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT tgrelid::regclass || '.' || tgname AS name FROM pg_trigger
      WHERE NOT tgisinternal ORDER BY 1`;
    expect(rows.map((r) => r.name)).toEqual([
      "cutting_orders.trg_order_insert_guard",
      "cutting_orders.trg_order_update_guard",
      "verification_items.trg_item_guard",
      "verification_items.trg_items_frozen_after_decision",
      "verification_logs.trg_log_insert_guard",
      "verification_logs.trg_logs_immutable",
    ]);
  });

  it("has row level security enabled on the seven app tables", async () => {
    const rows = await prisma.$queryRaw<{ relname: string }[]>`
      SELECT relname FROM pg_class
      WHERE relrowsecurity AND relnamespace = 'public'::regnamespace
        AND relname <> '_prisma_migrations'
      ORDER BY 1`;
    expect(rows.map((r) => r.relname)).toEqual([
      "cutting_orders",
      "recipe_components",
      "recipes",
      "refresh_tokens",
      "users",
      "verification_items",
      "verification_logs",
    ]);
  });
});
