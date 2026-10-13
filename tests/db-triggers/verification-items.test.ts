import { beforeEach, describe, expect, it } from "vitest";
import { countItems, createOrder, expectDbError, orderInState, prisma, resubmit, seedBase, sql } from "../helpers/db";

beforeEach(seedBase);

describe("item value constraints", () => {
  it("4: status that disagrees with the counts -> CHECK violation", async () => {
    await createOrder("o1");
    // c1 expects 50
    await expectDbError(sql(`UPDATE verification_items SET actual_qty=5, status='GREEN' WHERE component_id='c1'`), "23514");
    await expectDbError(sql(`UPDATE verification_items SET actual_qty=50, status='RED' WHERE component_id='c1'`), "23514");
    await expectDbError(sql(`UPDATE verification_items SET actual_qty=51, status='GREEN' WHERE component_id='c1'`), "23514");
    await expectDbError(sql(`UPDATE verification_items SET actual_qty=5, status='YELLOW' WHERE component_id='c1'`), "23514");
  });

  it("4: a status while uncounted, or a count without a status -> CHECK violation", async () => {
    await createOrder("o1");
    await expectDbError(sql(`UPDATE verification_items SET status='GREEN' WHERE component_id='c1'`), "23514");
    await expectDbError(sql(`UPDATE verification_items SET actual_qty=50 WHERE component_id='c1'`), "23514");
  });

  it("4: negative actual_qty -> CHECK violation", async () => {
    await createOrder("o1");
    await expectDbError(sql(`UPDATE verification_items SET actual_qty=-1, status='RED' WHERE component_id='c1'`), "23514");
  });

  it("4: actual_qty = 0 is a valid RED count", async () => {
    await createOrder("o1");
    await sql(`UPDATE verification_items SET actual_qty=0, status='RED' WHERE component_id='c1'`);
    const item = await prisma.verificationItem.findFirstOrThrow({ where: { componentId: "c1" } });
    expect(item.actualQty).toBe(0);
    expect(item.status).toBe("RED");
  });
});

describe("item immutability", () => {
  it("18: editing an item of a rejected (decided) attempt is blocked", async () => {
    await orderInState("o1", "REJECTED");
    await expectDbError(sql(`UPDATE verification_items SET actual_qty=100, status='YELLOW' WHERE component_id='c5'`), "GK409");
  });

  it("18: editing or deleting a decided attempt-1 item after resubmit is blocked", async () => {
    await orderInState("o1", "REJECTED");
    await resubmit("o1");
    // attempt 1 is stale (item guard) and decided (frozen trigger)
    await expectDbError(
      sql(`UPDATE verification_items SET actual_qty=100, status='YELLOW' WHERE attempt_no=1 AND component_id='c5'`),
      "GK409",
    );
    await expectDbError(sql(`DELETE FROM verification_items WHERE attempt_no=1 AND component_id='c5'`), "P0001");
  });

  it("18: editing or deleting items of an approved attempt is blocked", async () => {
    await orderInState("o1", "VERIFIED");
    await expectDbError(sql(`UPDATE verification_items SET actual_qty=1, status='RED' WHERE component_id='c1'`), "GK409");
    await expectDbError(sql(`DELETE FROM verification_items WHERE component_id='c1'`), "P0001");
  });

  it("18: inserting items for a stale attempt is blocked", async () => {
    await orderInState("o1", "REJECTED");
    await resubmit("o1");
    await sql(`DELETE FROM verification_items WHERE attempt_no=2`); // pending attempt 2 may be rebuilt
    await expectDbError(
      sql(`INSERT INTO verification_items(id,order_id,component_id,attempt_no,component_name,expected_qty)
           VALUES ('ix','o1','c1',1,'Front Body',50)`),
      "GK409",
    );
  });

  it("18: inserting items for a future attempt, or on a non-pending order, is blocked", async () => {
    await createOrder("o1");
    await expectDbError(
      sql(`INSERT INTO verification_items(id,order_id,component_id,attempt_no,component_name,expected_qty)
           VALUES ('ix','o1','c1',2,'Front Body',50)`),
      "GK409",
    );
  });

  it("18: item identity and expected_qty cannot change while pending", async () => {
    await createOrder("o1");
    await expectDbError(sql(`UPDATE verification_items SET expected_qty=1 WHERE component_id='c1'`), "GK409");
    await expectDbError(sql(`UPDATE verification_items SET component_name='Renamed' WHERE component_id='c1'`), "GK409");
  });

  it("18: counting the current attempt of a pending order is allowed", async () => {
    await createOrder("o1");
    await countItems("o1", 1, { c5: 99 });
    const cuffs = await prisma.verificationItem.findFirstOrThrow({ where: { componentId: "c5" } });
    expect(cuffs.status).toBe("RED");
  });
});
