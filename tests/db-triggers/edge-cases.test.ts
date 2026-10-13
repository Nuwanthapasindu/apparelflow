import { beforeEach, describe, expect, it } from "vitest";
import {
  approve,
  countItems,
  createOrder,
  expectDbError,
  orderInState,
  prisma,
  reject,
  resubmit,
  seedBase,
  sql,
} from "../helpers/db";

beforeEach(seedBase);

const approvedLog = (orderId: string, attempt: number, by = "u_ver", id = `l_${orderId}_${attempt}_${by}`) =>
  sql(`INSERT INTO verification_logs(id,order_id,attempt_no,verifier_id,decision,expected_fabric_yds,actual_fabric_yds,wastage_pct,wastage_cap_pct,over_cap)
       VALUES ('${id}','${orderId}',${attempt},'${by}','APPROVED',90,91,1.11,5,false)`);

const insertOrder = (extra: { orderNo?: string; qty?: string; yds?: string }) =>
  sql(`INSERT INTO cutting_orders(id,order_no,recipe_id,target_qty,fabric_roll_id,actual_fabric_yds,created_by,updated_at)
       VALUES ('ox','${extra.orderNo ?? "ORD-X"}','r1',${extra.qty ?? "50"},'F',${extra.yds ?? "90"},'u_sup',now())`);

describe("edge cases: boundaries", () => {
  it("shortage of exactly one piece is RED, exact is GREEN, one extra is YELLOW, the int maximum is accepted", async () => {
    await createOrder("o1");
    await sql(`UPDATE verification_items SET actual_qty=49, status='RED' WHERE component_id='c1'`);
    await sql(`UPDATE verification_items SET actual_qty=50, status='GREEN' WHERE component_id='c1'`);
    await sql(`UPDATE verification_items SET actual_qty=51, status='YELLOW' WHERE component_id='c1'`);
    await sql(`UPDATE verification_items SET actual_qty=2147483647, status='YELLOW' WHERE component_id='c1'`);
    await expectDbError(sql(`UPDATE verification_items SET actual_qty=2147483648, status='YELLOW' WHERE component_id='c1'`), "22003");
  });

  it("a single-garment order works end to end", async () => {
    await createOrder("o1", { targetQty: 1 });
    await countItems("o1", 1);
    await approve("o1");
    expect((await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: "o1" } })).status).toBe("VERIFIED");
  });

  it("target_qty beyond the int range is rejected, not truncated", async () => {
    await expectDbError(insertOrder({ qty: "2147483648" }), "22003");
  });

  it("fabric yards must be positive and fit numeric(8,2)", async () => {
    await expectDbError(insertOrder({ yds: "0" }), "23514");
    await expectDbError(insertOrder({ yds: "-1.50" }), "23514");
    await expectDbError(insertOrder({ yds: "1000000" }), "22003");
    await insertOrder({ yds: "999999.99" });
  });

  it("an order can be rejected several times and approved on the third attempt", async () => {
    await createOrder("o1");
    await countItems("o1", 1, { c5: 1 });
    await reject("o1", 1, "first");
    await resubmit("o1");
    await countItems("o1", 2, { c1: 0 });
    await reject("o1", 2, "second");
    expect(await resubmit("o1")).toBe(3);
    await countItems("o1", 3);
    await approve("o1", 3);

    const logs = await prisma.verificationLog.findMany({ where: { orderId: "o1" }, orderBy: { attemptNo: "asc" } });
    expect(logs.map((l) => [l.attemptNo, l.decision])).toEqual([[1, "REJECTED"], [2, "REJECTED"], [3, "APPROVED"]]);
    expect(await prisma.verificationItem.count({ where: { orderId: "o1" } })).toBe(15);
  });
});

describe("edge cases: duplicates and invalid values", () => {
  it("duplicate order_no, email, recipe component and item rows -> unique violation", async () => {
    await createOrder("o1");
    await expectDbError(insertOrder({ orderNo: "ORD-o1" }), "23505");
    await expectDbError(sql(`INSERT INTO users(id,email,password_hash,role,full_name) VALUES ('u9','s@x','h','cutting_verifier','Dup')`), "23505");
    await expectDbError(sql(`INSERT INTO recipe_components(id,recipe_id,component_name,pieces_per_garment) VALUES ('c9','r1','Cuffs',1)`), "23505");
    await expectDbError(
      sql(`INSERT INTO verification_items(id,order_id,component_id,attempt_no,component_name,expected_qty) VALUES ('dup','o1','c1',1,'Front Body',50)`),
      "23505",
    );
  });

  it("an unknown enum value is rejected", async () => {
    await createOrder("o1");
    await expectDbError(sql(`UPDATE cutting_orders SET status='HACKED' WHERE id='o1'`), "22P02");
    await expectDbError(sql(`UPDATE users SET role='admin' WHERE id='u_sup'`), "22P02");
  });

  it("a non-positive expected_qty is rejected", async () => {
    await createOrder("o1");
    await sql(`DELETE FROM verification_items WHERE component_id='c1'`);
    await expectDbError(
      sql(`INSERT INTO verification_items(id,order_id,component_id,attempt_no,component_name,expected_qty) VALUES ('z','o1','c1',1,'Front Body',0)`),
      "23514",
    );
  });
});

describe("business rules: recipes are snapshotted", () => {
  it("editing the recipe later does not change an order's items", async () => {
    await createOrder("o1");
    await sql(`UPDATE recipe_components SET component_name='Renamed', pieces_per_garment=9 WHERE id='c5'`);
    const cuffs = await prisma.verificationItem.findFirstOrThrow({ where: { orderId: "o1", componentId: "c5" } });
    expect([cuffs.componentName, cuffs.expectedQty]).toEqual(["Cuffs", 100]);
    await countItems("o1", 1);
    await approve("o1");
  });

  it("a component added to the recipe while an order is pending blocks its approval (the new part is uncounted)", async () => {
    await createOrder("o1");
    await countItems("o1", 1);
    await sql(`INSERT INTO recipe_components(id,recipe_id,component_name,pieces_per_garment) VALUES ('c6','r1','Pocket',1)`);
    await expectDbError(approvedLog("o1", 1), "GK422");
  });
});

describe("security: evidence cannot be reused or borrowed", () => {
  it("approving a resubmitted attempt with only the old attempt counted -> GK422", async () => {
    await createOrder("o1");
    await countItems("o1", 1, { c5: 1 });
    await reject("o1", 1);
    await resubmit("o1"); // attempt 2 items start uncounted
    await expectDbError(approvedLog("o1", 2), "GK422");
  });

  it("an order cannot be approved on another order's counted items -> GK422", async () => {
    await createOrder("o1");
    await createOrder("o2");
    await countItems("o1", 1);
    await expectDbError(approvedLog("o2", 1), "GK422");
  });

  it("an already-approved order cannot be approved again, by anyone", async () => {
    await orderInState("o1", "VERIFIED");
    await prisma.user.create({ data: { id: "u_ver2", email: "v2@x", passwordHash: "h", role: "cutting_verifier", fullName: "Ver2" } });
    await expectDbError(approvedLog("o1", 1, "u_ver2"), "GK409");
    await expectDbError(approvedLog("o1", 1, "u_ver"), "GK409");
  });

  it("starting sewing cannot be repeated to overwrite who started it or when", async () => {
    await orderInState("o1", "IN_SEWING");
    const before = await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: "o1" } });
    await prisma.user.create({ data: { id: "u_sew2", email: "w2@x", passwordHash: "h", role: "sewing_supervisor", fullName: "Sew2" } });
    await expectDbError(sql(`UPDATE cutting_orders SET sewing_started_by='u_sew2' WHERE id='o1'`), "GK409");
    await expectDbError(sql(`UPDATE cutting_orders SET sewing_started_at=now() WHERE id='o1'`), "GK409");
    await expectDbError(sql(`UPDATE cutting_orders SET sewing_started_by=NULL, sewing_started_at=NULL WHERE id='o1'`), "GK409");
    await expectDbError(
      sql(`UPDATE cutting_orders SET status='IN_SEWING', sewing_started_by='u_sew2', sewing_started_at=now() WHERE id='o1'`),
      "GK409",
    );
    const after = await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: "o1" } });
    expect([after.sewingStartedById, after.sewingStartedAt]).toEqual([before.sewingStartedById, before.sewingStartedAt]);
  });

  it("a verified order stays verified when its approving log is the only thing someone tries to change", async () => {
    await orderInState("o1", "VERIFIED");
    await expectDbError(sql(`UPDATE verification_logs SET decision='REJECTED', rejection_note='x'`), "P0001");
    expect((await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: "o1" } })).status).toBe("VERIFIED");
  });
});

describe("security: audit data cannot be orphaned", () => {
  it("users who decided, orders with history and recipes in use cannot be deleted -> FK violation", async () => {
    await orderInState("o1", "REJECTED");
    await expectDbError(sql(`DELETE FROM users WHERE id='u_ver'`), "23503");
    await expectDbError(sql(`DELETE FROM users WHERE id='u_sup'`), "23503");
    await expectDbError(sql(`DELETE FROM cutting_orders WHERE id='o1'`), "23503");
    await expectDbError(sql(`DELETE FROM recipes WHERE id='r1'`), "23503");
    await expectDbError(sql(`DELETE FROM recipe_components WHERE id='c1'`), "23503");
  });

  it("a log cannot point at an unknown order or verifier", async () => {
    await createOrder("o1");
    await expectDbError(
      sql(`INSERT INTO verification_logs(id,order_id,attempt_no,verifier_id,decision,rejection_note) VALUES ('l','nope',1,'u_ver','REJECTED','x')`),
      "GK409", // the guard reads the missing order as "not pending"
    );
    await expectDbError(
      sql(`INSERT INTO verification_logs(id,order_id,attempt_no,verifier_id,decision,rejection_note) VALUES ('l','o1',1,'nobody','REJECTED','x')`),
      "GK403",
    );
  });
});

describe("security: hostile text is stored as data", () => {
  it.each([
    `'; DROP TABLE verification_logs; --`,
    `Robert'); DELETE FROM users; --`,
    `<script>alert(1)</script> \u{1F9F5} ‮ reversed`,
  ])("rejection note %j is stored verbatim and nothing else changes", async (note) => {
    await orderInState("o1", "PENDING");
    await reject("o1", 1, note);
    const log = await prisma.verificationLog.findUniqueOrThrow({ where: { orderId_attemptNo: { orderId: "o1", attemptNo: 1 } } });
    expect(log.rejectionNote).toBe(note);
    expect(await prisma.user.count()).toBe(3);
  });
});

describe("unusual behaviour: concurrency", () => {
  it("two verifiers deciding the same attempt at once: exactly one decision is stored", async () => {
    await createOrder("o1");
    await countItems("o1", 1);
    await prisma.user.create({ data: { id: "u_ver2", email: "v2@x", passwordHash: "h", role: "cutting_verifier", fullName: "Ver2" } });

    const results = await Promise.allSettled([
      approvedLog("o1", 1, "u_ver", "l_a"),
      approvedLog("o1", 1, "u_ver2", "l_b"),
      sql(`INSERT INTO verification_logs(id,order_id,attempt_no,verifier_id,decision,rejection_note) VALUES ('l_c','o1',1,'u_ver2','REJECTED','racing reject')`),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const loser of results.filter((r) => r.status === "rejected")) {
      expect((loser as PromiseRejectedResult).reason.meta.code).toBe("23505");
    }
    expect(await prisma.verificationLog.count({ where: { orderId: "o1", attemptNo: 1 } })).toBe(1);
  });
});

describe("security: row level security closes the Data API path", () => {
  // Stands in for Supabase's anon/authenticated roles: no BYPASSRLS, no policies.
  async function asLimitedRole<T>(work: (run: (statement: string) => Promise<unknown>) => Promise<T>) {
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_anon') THEN CREATE ROLE app_anon NOLOGIN; END IF;
    END $$`);
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO app_anon`);
    await prisma.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_anon`);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE app_anon`);
      return work((statement) => tx.$queryRawUnsafe(statement));
    });
  }

  it("a role without BYPASSRLS sees no rows in any table or in the variance view", async () => {
    await orderInState("o1", "REJECTED");
    const counts = await asLimitedRole(async (run) => {
      const out: Record<string, number> = {};
      for (const table of ["users", "refresh_tokens", "recipes", "recipe_components", "cutting_orders", "verification_items", "verification_logs", "verification_variances"]) {
        const rows = (await run(`SELECT count(*)::int AS n FROM ${table}`)) as { n: number }[];
        out[table] = rows[0].n;
      }
      return out;
    });
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    expect(await prisma.user.count()).toBe(3); // the rows exist, they are just invisible to that role
  });

  it("a role without BYPASSRLS cannot write", async () => {
    await expectDbError(
      asLimitedRole((run) => run(`INSERT INTO users(id,email,password_hash,role,full_name) VALUES ('evil','e@x','h','cutting_verifier','Evil')`)),
      "42501",
    );
    expect(await prisma.user.count({ where: { id: "evil" } })).toBe(0);
  });
});
