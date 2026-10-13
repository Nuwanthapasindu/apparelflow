import { beforeEach, describe, it } from "vitest";
import { expectDbError, orderInState, seedBase, sql } from "../helpers/db";

beforeEach(seedBase);

const insertOrder = (columns: { status?: string; attempt?: number; qty?: number; by?: string }) =>
  sql(`INSERT INTO cutting_orders(id,order_no,recipe_id,target_qty,fabric_roll_id,actual_fabric_yds,status,current_attempt,created_by,updated_at)
       VALUES ('ox','ORD-X','r1',${columns.qty ?? 50},'F',90,'${columns.status ?? "PENDING_VERIFICATION"}',${columns.attempt ?? 1},'${columns.by ?? "u_sup"}',now())`);

describe("order insert guard", () => {
  it("1: order created by a non-supervisor -> GK403", async () => {
    await expectDbError(insertOrder({ by: "u_ver" }), "GK403");
    await expectDbError(insertOrder({ by: "u_sew" }), "GK403");
  });

  it("1: order created by an unknown or deactivated user -> GK403", async () => {
    await expectDbError(insertOrder({ by: "nobody" }), "GK403");
    await sql(`UPDATE users SET is_active = false WHERE id = 'u_sup'`);
    await expectDbError(insertOrder({}), "GK403");
  });

  it("2: order with a status other than PENDING_VERIFICATION -> GK409", async () => {
    for (const status of ["VERIFIED", "REJECTED", "IN_SEWING", "CUTTING_IN_PROGRESS"]) {
      await expectDbError(insertOrder({ status }), "GK409");
    }
  });

  it("2: order with attempt other than 1 -> GK409", async () => {
    await expectDbError(insertOrder({ attempt: 2 }), "GK409");
  });

  it("3: order with target_qty = 0 (or negative) -> CHECK violation", async () => {
    await expectDbError(insertOrder({ qty: 0 }), "23514");
    await expectDbError(insertOrder({ qty: -5 }), "23514");
  });
});

describe("order update guard: VERIFIED needs an approval", () => {
  it("12: PENDING -> VERIFIED without any log -> GK422", async () => {
    await orderInState("o1", "PENDING");
    await expectDbError(sql(`UPDATE cutting_orders SET status='VERIFIED' WHERE id='o1'`), "GK422");
  });

  it("12: PENDING -> VERIFIED with only a REJECTED log for the attempt -> GK422", async () => {
    await orderInState("o1", "PENDING");
    await sql(`INSERT INTO verification_logs(id,order_id,attempt_no,verifier_id,decision,rejection_note)
               VALUES ('l1','o1',1,'u_ver','REJECTED','Cuffs short')`);
    await expectDbError(sql(`UPDATE cutting_orders SET status='VERIFIED' WHERE id='o1'`), "GK422");
  });

  it("12: PENDING -> REJECTED without a REJECTED log -> GK409", async () => {
    await orderInState("o1", "PENDING");
    await expectDbError(sql(`UPDATE cutting_orders SET status='REJECTED' WHERE id='o1'`), "GK409");
  });
});

describe("order update guard: illegal transitions", () => {
  it("13: REJECTED -> VERIFIED -> GK409", async () => {
    await orderInState("o1", "REJECTED");
    await expectDbError(sql(`UPDATE cutting_orders SET status='VERIFIED' WHERE id='o1'`), "GK409");
  });

  it("13: REJECTED -> IN_SEWING -> GK409", async () => {
    await orderInState("o1", "REJECTED");
    await expectDbError(
      sql(`UPDATE cutting_orders SET status='IN_SEWING', sewing_started_by='u_sew', sewing_started_at=now() WHERE id='o1'`),
      "GK409",
    );
  });

  it("13: VERIFIED -> PENDING_VERIFICATION -> GK409", async () => {
    await orderInState("o1", "VERIFIED");
    await expectDbError(sql(`UPDATE cutting_orders SET status='PENDING_VERIFICATION' WHERE id='o1'`), "GK409");
  });

  it("13: VERIFIED -> REJECTED -> GK409", async () => {
    await orderInState("o1", "VERIFIED");
    await expectDbError(sql(`UPDATE cutting_orders SET status='REJECTED' WHERE id='o1'`), "GK409");
  });

  it("13: IN_SEWING -> VERIFIED -> GK409", async () => {
    await orderInState("o1", "IN_SEWING");
    await expectDbError(sql(`UPDATE cutting_orders SET status='VERIFIED' WHERE id='o1'`), "GK409");
  });
});

describe("order update guard: attempts", () => {
  it("14: resubmit with current_attempt +2, or unchanged, -> GK409", async () => {
    await orderInState("o1", "REJECTED");
    await expectDbError(
      sql(`UPDATE cutting_orders SET status='PENDING_VERIFICATION', current_attempt=3 WHERE id='o1'`),
      "GK409",
    );
    await expectDbError(sql(`UPDATE cutting_orders SET status='PENDING_VERIFICATION' WHERE id='o1'`), "GK409");
  });

  it("14: changing current_attempt without a resubmit -> GK409", async () => {
    await orderInState("o1", "PENDING");
    await expectDbError(sql(`UPDATE cutting_orders SET current_attempt=5 WHERE id='o1'`), "GK409");
  });
});

describe("order update guard: starting sewing", () => {
  it("15: IN_SEWING set by a non-sewing-supervisor -> GK403", async () => {
    await orderInState("o1", "VERIFIED");
    for (const by of ["u_ver", "u_sup"]) {
      await expectDbError(
        sql(`UPDATE cutting_orders SET status='IN_SEWING', sewing_started_by='${by}', sewing_started_at=now() WHERE id='o1'`),
        "GK403",
      );
    }
  });

  it("15: IN_SEWING with no sewing_started_by -> GK403", async () => {
    await orderInState("o1", "VERIFIED");
    await expectDbError(
      sql(`UPDATE cutting_orders SET status='IN_SEWING', sewing_started_at=now() WHERE id='o1'`),
      "GK403",
    );
  });

  it("16: IN_SEWING without sewing_started_at -> GK409", async () => {
    await orderInState("o1", "VERIFIED");
    await expectDbError(
      sql(`UPDATE cutting_orders SET status='IN_SEWING', sewing_started_by='u_sew' WHERE id='o1'`),
      "GK409",
    );
  });

  it("16: sewing fields set without the transition -> GK409", async () => {
    await orderInState("o1", "VERIFIED");
    await expectDbError(
      sql(`UPDATE cutting_orders SET sewing_started_by='u_sew', sewing_started_at=now() WHERE id='o1'`),
      "GK409",
    );
  });
});

describe("order update guard: verified orders are frozen", () => {
  it.each(["VERIFIED", "IN_SEWING"] as const)("17: definition edits on a %s order -> GK409", async (state) => {
    await orderInState("o1", state);
    for (const change of [
      "target_qty = 999",
      "actual_fabric_yds = 10",
      "fabric_roll_id = 'OTHER'",
      "order_no = 'ORD-CHANGED'",
      "created_by = 'u_ver'",
    ]) {
      await expectDbError(sql(`UPDATE cutting_orders SET ${change} WHERE id='o1'`), "GK409");
    }
  });
});
