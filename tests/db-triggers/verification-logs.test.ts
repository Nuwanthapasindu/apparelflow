import { beforeEach, describe, expect, it } from "vitest";
import { countItems, createOrder, expectDbError, orderInState, prisma, seedBase, sql } from "../helpers/db";

beforeEach(seedBase);

const approvedLog = (id = "l_x", attempt = 1, by = "u_ver") =>
  sql(`INSERT INTO verification_logs(id,order_id,attempt_no,verifier_id,decision,expected_fabric_yds,actual_fabric_yds,wastage_pct,wastage_cap_pct,over_cap)
       VALUES ('${id}','o1',${attempt},'${by}','APPROVED',90,91,1.11,5,false)`);

const rejectedLog = (note: string | null, id = "l_x", attempt = 1, by = "u_ver") =>
  sql(`INSERT INTO verification_logs(id,order_id,attempt_no,verifier_id,decision,rejection_note)
       VALUES ('${id}','o1',${attempt},'${by}','REJECTED',${note === null ? "NULL" : `'${note}'`})`);

describe("hard stop: APPROVED log", () => {
  it("5: uncounted items -> GK422", async () => {
    await createOrder("o1");
    await expectDbError(approvedLog(), "GK422");
  });

  it("5: only some items counted -> GK422", async () => {
    await createOrder("o1");
    await sql(`UPDATE verification_items SET actual_qty=expected_qty, status='GREEN' WHERE component_id <> 'c5'`);
    await expectDbError(approvedLog(), "GK422");
  });

  it("6: any RED item -> GK422", async () => {
    await createOrder("o1");
    await countItems("o1", 1, { c5: 99 });
    await expectDbError(approvedLog(), "GK422");
  });

  it("6: a zero count is RED and blocks approval -> GK422", async () => {
    await createOrder("o1");
    await countItems("o1", 1, { c1: 0 });
    await expectDbError(approvedLog(), "GK422");
  });

  it("7: a missing component row -> GK422", async () => {
    await createOrder("o1");
    await countItems("o1", 1);
    // Rows are frozen only after a decision, so a missing row can be simulated while pending.
    await sql(`DELETE FROM verification_items WHERE component_id='c4'`);
    await expectDbError(approvedLog(), "GK422");
  });

  it("5-7: nothing was written and the order is still pending", async () => {
    await createOrder("o1");
    await expectDbError(approvedLog(), "GK422");
    expect(await prisma.verificationLog.count()).toBe(0);
    expect((await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: "o1" } })).status).toBe("PENDING_VERIFICATION");
  });

  it("an APPROVED log without the fabric snapshot -> CHECK violation", async () => {
    await createOrder("o1");
    await countItems("o1", 1);
    await expectDbError(
      sql(`INSERT INTO verification_logs(id,order_id,attempt_no,verifier_id,decision) VALUES ('l_x','o1',1,'u_ver','APPROVED')`),
      "23514",
    );
  });
});

describe("log guards", () => {
  it("8: log by a non-verifier -> GK403", async () => {
    await createOrder("o1");
    await expectDbError(rejectedLog("short cuffs", "l_x", 1, "u_sup"), "GK403");
    await expectDbError(rejectedLog("short cuffs", "l_x", 1, "u_sew"), "GK403");
  });

  it("8: approval by a non-verifier is refused even when every item is counted -> GK403", async () => {
    await createOrder("o1");
    await countItems("o1", 1);
    await expectDbError(approvedLog("l_x", 1, "u_sup"), "GK403");
  });

  it("8: log by a deactivated verifier -> GK403", async () => {
    await createOrder("o1");
    await sql(`UPDATE users SET is_active=false WHERE id='u_ver'`);
    await expectDbError(rejectedLog("short cuffs"), "GK403");
  });

  it("9: stale or future attempt_no -> GK409", async () => {
    await createOrder("o1");
    await expectDbError(rejectedLog("short cuffs", "l_x", 2), "GK409");
    await expectDbError(rejectedLog("short cuffs", "l_x", 0), "GK409");
  });

  it("9: log on a non-pending order -> GK409", async () => {
    await orderInState("o1", "REJECTED");
    await expectDbError(rejectedLog("again", "l_y", 1), "GK409");
    await expectDbError(rejectedLog("again", "l_y", 2), "GK409");
    await orderInState("o2", "VERIFIED");
    await expectDbError(
      sql(`INSERT INTO verification_logs(id,order_id,attempt_no,verifier_id,decision,rejection_note) VALUES ('l_z','o2',1,'u_ver','REJECTED','late')`),
      "GK409",
    );
  });

  it("10: REJECTED log with no note or a blank note -> CHECK violation", async () => {
    await createOrder("o1");
    await expectDbError(rejectedLog(null), "23514");
    await expectDbError(rejectedLog(""), "23514");
    await expectDbError(rejectedLog("   "), "23514");
  });

  it("11: a second log for the same order and attempt -> unique violation", async () => {
    await createOrder("o1");
    await rejectedLog("Cuffs short");
    // The order is still PENDING here (status not yet updated), so only the unique key stops it.
    await expectDbError(rejectedLog("again", "l_y"), "23505");
  });
});

describe("verification_logs is append-only", () => {
  it("19: UPDATE and DELETE are blocked (generic P0001)", async () => {
    await orderInState("o1", "REJECTED");
    await expectDbError(sql(`UPDATE verification_logs SET rejection_note='edited'`), "P0001");
    await expectDbError(sql(`UPDATE verification_logs SET decision='APPROVED'`), "P0001");
    await expectDbError(sql(`DELETE FROM verification_logs`), "P0001");
    const logs = await prisma.verificationLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0].rejectionNote).toBe("Cuffs short by 1 piece");
  });

  it("19: the typed client cannot edit a log either", async () => {
    await orderInState("o1", "VERIFIED");
    await expect(
      prisma.verificationLog.updateMany({ data: { overCap: false } }),
    ).rejects.toThrow();
    await expect(prisma.verificationLog.deleteMany()).rejects.toThrow();
  });
});
