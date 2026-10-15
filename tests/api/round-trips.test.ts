import { beforeEach, describe, expect, it, vi } from "vitest";

// The app's database client is replaced by one that records every SQL statement, so the number of
// round trips of each request can be counted. (The helpers use their own client and are not counted.)
const log = vi.hoisted(() => ({ queries: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  client.$on("query", (event) => log.queries.push(event.query));
  return { prisma: client };
});

import * as orderRoute from "@/app/api/orders/route";
import { as } from "../helpers/orders";
import {
  approveRequest,
  countsFor,
  createPending,
  rejectRequest,
  resubmitRequest,
  saveCountsRequest,
  setupVerification,
  type VerificationContext,
} from "../helpers/verification";
import { createRejected, createVerified, sewingStartRequest } from "../helpers/sewing";

let ctx: VerificationContext;
beforeEach(async () => {
  ctx = await setupVerification();
});

/** Runs one request and returns the statements the app sent: all of them, and those between BEGIN and COMMIT. */
async function measure(run: () => Promise<Response>, expectedStatus = 200) {
  log.queries.length = 0;
  const response = await run();
  const sent = [...log.queries];
  expect(response.status).toBe(expectedStatus);
  const begin = sent.indexOf("BEGIN");
  const commit = sent.lastIndexOf("COMMIT");
  return { total: sent.length, inTransaction: begin === -1 ? 0 : commit - begin + 1 };
}

// Each statement is a network round trip. Between a serverless function and a database on another
// continent a trip costs hundreds of milliseconds, and Prisma cancels a transaction after its timeout
// (P2028), so a mutation that makes too many trips fails in production while passing locally. Before
// these budgets, saving counts made 14 statements (12 inside the transaction) and failed on the live site.
const TOTAL_BUDGET = 8;
const IN_TRANSACTION_BUDGET = 6;

async function expectWithinBudget(run: () => Promise<Response>, expectedStatus = 200) {
  const { total, inTransaction } = await measure(run, expectedStatus);
  expect(total, "statements sent for the request").toBeLessThanOrEqual(TOTAL_BUDGET);
  expect(inTransaction, "statements between BEGIN and COMMIT").toBeLessThanOrEqual(IN_TRANSACTION_BUDGET);
}

describe("round trips per mutation (a database far away must not time out)", () => {
  it("create order", async () => {
    const body = { recipeId: ctx.recipes.blouse.id, targetQty: 50, fabricRollId: "ROLL-RT-1", actualFabricYds: "91.00" };
    await expectWithinBudget(async () => orderRoute.POST(await as(ctx.users.supervisor.id, "POST", "/api/orders", { body }), undefined), 201);
  });

  it("save counts for a five-component recipe", async () => {
    const order = await createPending(ctx);
    await expectWithinBudget(() => saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order)));
  });

  it("approve", async () => {
    const order = await createPending(ctx);
    await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order));
    await expectWithinBudget(() => approveRequest(order.id, ctx.users.verifier.id));
  });

  it("reject", async () => {
    const order = await createPending(ctx);
    await expectWithinBudget(() => rejectRequest(order.id, ctx.users.verifier.id, { note: "Sleeve seam damaged" }));
  });

  it("resubmit", async () => {
    const order = await createRejected(ctx);
    await expectWithinBudget(() => resubmitRequest(order.id, ctx.users.supervisor.id));
  });

  it("start sewing", async () => {
    const order = await createVerified(ctx);
    await expectWithinBudget(() => sewingStartRequest(order.id, ctx.users.sewing.id));
  });
});
