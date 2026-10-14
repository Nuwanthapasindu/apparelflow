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
  startSewing,
} from "../helpers/db";

beforeEach(seedBase);

// Gaps found by probing the Day 1 guards with direct SQL, closed by the
// fix_gatekeeper_guard_gaps migration. Each describe block is one gap.

const approvedLog = (id = "l_ok") =>
  sql(`INSERT INTO verification_logs(id,order_id,attempt_no,verifier_id,decision,expected_fabric_yds,actual_fabric_yds,wastage_pct,wastage_cap_pct,over_cap)
       VALUES ('${id}','o1',1,'u_ver','APPROVED',90,91,1.11,5,false)`);

const rejectedLog = (note: string) =>
  prisma.verificationLog.create({
    data: { orderId: "o1", attemptNo: 1, verifierId: "u_ver", decision: "REJECTED", rejectionNote: note },
  });

/** A second recipe whose component is not part of recipe r1. */
async function foreignRecipe() {
  await prisma.recipe.create({
    data: {
      id: "r2",
      recipeCode: "REC-CT02",
      name: "Crop Top",
      category: "Top",
      stdFabricYards: "1.10",
      wastageCap: "8.00",
      components: { create: [{ id: "x1", componentName: "Front Chest", piecesPerGarment: 1 }] },
    },
  });
}

describe("gap 1: items and approval must match the order's recipe", () => {
  it("an item for a component of another recipe is rejected -> GK422", async () => {
    await foreignRecipe();
    await createOrder("o1");
    await sql(`DELETE FROM verification_items WHERE component_id='c4'`);
    await expectDbError(
      sql(`INSERT INTO verification_items(id,order_id,component_id,attempt_no,component_name,expected_qty)
           VALUES ('i_x','o1','x1',1,'Front Chest',50)`),
      "GK422",
    );
  });

  it("an item with a forged expected_qty or name is rejected -> GK422", async () => {
    await createOrder("o1");
    await sql(`DELETE FROM verification_items WHERE component_id='c1'`);
    // expected 0 would make any count GREEN, so the approval could not be blocked
    await expectDbError(
      sql(`INSERT INTO verification_items(id,order_id,component_id,attempt_no,component_name,expected_qty)
           VALUES ('i_x','o1','c1',1,'Front Body',0)`),
      "GK422",
    );
    await expectDbError(
      sql(`INSERT INTO verification_items(id,order_id,component_id,attempt_no,component_name,expected_qty)
           VALUES ('i_x','o1','c1',1,'Renamed',50)`),
      "GK422",
    );
    await sql(`INSERT INTO verification_items(id,order_id,component_id,attempt_no,component_name,expected_qty)
               VALUES ('i_x','o1','c1',1,'Front Body',50)`);
  });

  it("approval guard on its own: a foreign-recipe item cannot stand in for a missing component -> GK422", async () => {
    await foreignRecipe();
    await createOrder("o1");
    await countItems("o1", 1);
    await sql(`DELETE FROM verification_items WHERE component_id='c4'`);
    // Bypass the item guard to prove the approval guard does not rely on it.
    await sql(`ALTER TABLE verification_items DISABLE TRIGGER trg_item_guard`);
    try {
      await sql(`INSERT INTO verification_items(id,order_id,component_id,attempt_no,component_name,expected_qty,actual_qty,status)
                 VALUES ('i_x','o1','x1',1,'Front Chest',50,50,'GREEN')`);
    } finally {
      await sql(`ALTER TABLE verification_items ENABLE TRIGGER trg_item_guard`);
    }
    expect(await prisma.verificationItem.count({ where: { orderId: "o1", attemptNo: 1 } })).toBe(5);
    await expectDbError(approvedLog(), "GK422");
    expect(await prisma.verificationLog.count()).toBe(0);
  });

  it("a complete, correctly counted order still approves", async () => {
    await orderInState("o1", "VERIFIED");
    expect((await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: "o1" } })).status).toBe("VERIFIED");
  });

  it("a resubmitted attempt gets items that match the (unchanged) target_qty", async () => {
    await orderInState("o1", "REJECTED");
    const attempt = await resubmit("o1");
    await countItems("o1", attempt);
    await approve("o1", attempt);
    expect((await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: "o1" } })).status).toBe("VERIFIED");
  });
});

describe("gap 2: a rejection note needs a non-whitespace character", () => {
  it.each([
    ["tab", "\t"],
    ["newline", "\n"],
    ["carriage return", "\r\n"],
    ["no-break space", String.fromCodePoint(0xa0)],
    ["mixed unicode whitespace", `  \t${String.fromCodePoint(0xa0, 0x2003, 0x3000)}\n `],
    ["line separator", String.fromCodePoint(0x2028)],
    ["next line (NEL)", String.fromCodePoint(0x85)],
    ["zero-width space", String.fromCodePoint(0x200b)],
    ["zero-width joiner and word joiner", String.fromCodePoint(0x200d, 0x2060)],
    ["byte order mark", String.fromCodePoint(0xfeff)],
    ["soft hyphen", String.fromCodePoint(0xad)],
    ["whitespace around zero-width characters", `  ${String.fromCodePoint(0x200b)}\t${String.fromCodePoint(0xfeff)}  `],
  ])("a note of only %s -> CHECK violation", async (_label, note) => {
    await createOrder("o1");
    await expectDbError(rejectedLog(note), "23514");
    expect(await prisma.verificationLog.count()).toBe(0);
  });

  it("empty and plain-space notes are still rejected", async () => {
    await createOrder("o1");
    await expectDbError(rejectedLog(""), "23514");
    await expectDbError(rejectedLog("     "), "23514");
  });

  it("a real note passes, even with surrounding whitespace", async () => {
    await createOrder("o1");
    await countItems("o1", 1, { c5: 49 * 2 });
    await rejectedLog("\n  Cuffs short by 1 piece \t");
    await prisma.cuttingOrder.update({ where: { id: "o1" }, data: { status: "REJECTED" } });
    expect(await prisma.verificationLog.count()).toBe(1);
  });
});

describe("gap 5: counting and approving the same attempt at the same time", () => {
  const gate = () => {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    return { opened, open };
  };
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("a RED count in flight blocks the approval until it commits, then the approval fails -> GK422", async () => {
    await createOrder("o1");
    await countItems("o1", 1);
    const { opened, open } = gate();
    let counted!: () => void;
    const countStarted = new Promise<void>((resolve) => (counted = resolve));

    const counter = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE verification_items SET actual_qty=0, status='RED' WHERE component_id='c1'`);
      counted();
      await opened;
    });
    await countStarted;

    let approvalSettled = false;
    const approval = approvedLog("l_race").then(
      () => ((approvalSettled = true), undefined),
      (e: unknown) => ((approvalSettled = true), e),
    );
    await wait(300);
    expect(approvalSettled, "the approval must wait for the in-flight count").toBe(false);

    open();
    await counter;
    const error = await approval;
    expect(error).toBeDefined();
    expect((await import("@/lib/db-errors")).sqlStateOf(error)).toBe("GK422");
    expect(await prisma.verificationLog.count()).toBe(0);
    expect(await prisma.verificationItem.count({ where: { status: "RED" } })).toBe(1);
  });

  it("an approval in flight blocks a later count until it commits, then the count fails -> GK409", async () => {
    await createOrder("o1");
    await countItems("o1", 1);
    const { opened, open } = gate();
    let logged!: () => void;
    const logInserted = new Promise<void>((resolve) => (logged = resolve));

    const approver = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO verification_logs(id,order_id,attempt_no,verifier_id,decision,expected_fabric_yds,actual_fabric_yds,wastage_pct,wastage_cap_pct,over_cap)
         VALUES ('l_race','o1',1,'u_ver','APPROVED',90,91,1.11,5,false)`,
      );
      logged();
      await opened;
      await tx.$executeRawUnsafe(`UPDATE cutting_orders SET status='VERIFIED' WHERE id='o1'`);
    });
    await logInserted;

    const count = sql(`UPDATE verification_items SET actual_qty=0, status='RED' WHERE component_id='c1'`).then(
      () => undefined,
      (e: unknown) => e,
    );
    await wait(300);
    open();
    await approver;
    const error = await count;
    expect(error).toBeDefined();
    expect((await import("@/lib/db-errors")).sqlStateOf(error)).toBe("GK409");
    expect(await prisma.verificationItem.count({ where: { status: "RED" } })).toBe(0);
    expect((await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: "o1" } })).status).toBe("VERIFIED");
  });
});

describe("gap 3: only an active sewing supervisor can start sewing", () => {
  it("a deactivated sewing supervisor -> GK403 and the order stays VERIFIED", async () => {
    await orderInState("o1", "VERIFIED");
    await sql(`UPDATE users SET is_active=false WHERE id='u_sew'`);
    await expectDbError(startSewing("o1"), "GK403");
    expect((await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: "o1" } })).status).toBe("VERIFIED");
  });

  it("an active sewing supervisor still can", async () => {
    await orderInState("o1", "VERIFIED");
    await startSewing("o1");
    expect((await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: "o1" } })).status).toBe("IN_SEWING");
  });
});

describe("gap 4: the batch definition is immutable", () => {
  it.each(["PENDING", "REJECTED"] as const)("target_qty and recipe_id cannot change on a %s order -> GK409", async (state) => {
    await foreignRecipe();
    await orderInState("o1", state);
    await expectDbError(sql(`UPDATE cutting_orders SET target_qty = 51 WHERE id='o1'`), "GK409");
    await expectDbError(sql(`UPDATE cutting_orders SET recipe_id = 'r2' WHERE id='o1'`), "GK409");
    await expectDbError(sql(`UPDATE cutting_orders SET fabric_roll_id = 'OTHER' WHERE id='o1'`), "GK409");
    await expectDbError(sql(`UPDATE cutting_orders SET order_no = 'ORD-CHANGED' WHERE id='o1'`), "GK409");
    await expectDbError(sql(`UPDATE cutting_orders SET created_by = 'u_ver' WHERE id='o1'`), "GK409");
  });

  it("target_qty cannot change in the same statement as a legal status change", async () => {
    await orderInState("o1", "REJECTED");
    await expectDbError(
      sql(`UPDATE cutting_orders SET status='PENDING_VERIFICATION', current_attempt=2, target_qty=60 WHERE id='o1'`),
      "GK409",
    );
  });

  it("fabric yards cannot change while pending, but can while rejected and on resubmit", async () => {
    await orderInState("o1", "PENDING");
    await expectDbError(sql(`UPDATE cutting_orders SET actual_fabric_yds = 80 WHERE id='o1'`), "GK409");

    await countItems("o1", 1, { c5: 49 * 2 });
    await reject("o1");
    await sql(`UPDATE cutting_orders SET actual_fabric_yds = 95.50 WHERE id='o1'`);
    await sql(
      `UPDATE cutting_orders SET status='PENDING_VERIFICATION', current_attempt=2, actual_fabric_yds = 96 WHERE id='o1'`,
    );
    const order = await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: "o1" } });
    expect(order.actualFabricYds.toString()).toBe("96");
  });

  it("an update that changes nothing in the definition is still allowed", async () => {
    await orderInState("o1", "PENDING");
    await sql(`UPDATE cutting_orders SET target_qty = target_qty, recipe_id = recipe_id WHERE id='o1'`);
  });
});
