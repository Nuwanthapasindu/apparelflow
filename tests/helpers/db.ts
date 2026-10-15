import { expect } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { sqlStateOf } from "@/lib/db-errors";
import { assertTestDatabase } from "./assert-test-database";

assertTestDatabase();

export const prisma = new PrismaClient();

// TRUNCATE, never DELETE: the append-only triggers block DELETE on verification_logs.
export async function resetDb() {
  await prisma.$executeRawUnsafe(
    "TRUNCATE verification_logs, verification_items, cutting_orders, recipe_components, recipes, refresh_tokens, users CASCADE",
  );
}

export const USERS = { sup: "u_sup", ver: "u_ver", sew: "u_sew" } as const;
export const RECIPE_ID = "r1";
// [id, name, pieces per garment]
export const COMPONENTS = [
  ["c1", "Front Body", 1],
  ["c2", "Back Body", 1],
  ["c3", "Sleeves", 2],
  ["c4", "Collar", 1],
  ["c5", "Cuffs", 2],
] as const;

export async function seedBase() {
  await prisma.user.createMany({
    data: [
      { id: USERS.sup, email: "s@x", passwordHash: "h", role: "cutting_supervisor", fullName: "Sup" },
      { id: USERS.ver, email: "v@x", passwordHash: "h", role: "cutting_verifier", fullName: "Ver" },
      { id: USERS.sew, email: "w@x", passwordHash: "h", role: "sewing_supervisor", fullName: "Sew" },
    ],
  });
  await prisma.recipe.create({
    data: {
      id: RECIPE_ID,
      recipeCode: "REC-BL01",
      name: "Casual Blouse",
      category: "Blouse",
      stdFabricYards: "1.80",
      wastageCap: "5.00",
      components: {
        create: COMPONENTS.map(([id, componentName, piecesPerGarment]) => ({
          id,
          componentName,
          piecesPerGarment,
        })),
      },
    },
  });
}

function itemStatus(actual: number, expected: number) {
  return actual === expected ? "GREEN" : actual > expected ? "YELLOW" : "RED";
}

/** Order plus one uncounted item per recipe component for attempt 1 (what order creation does). */
export async function createOrder(id = "o1", opts: { targetQty?: number; fabricYds?: string } = {}) {
  const targetQty = opts.targetQty ?? 50;
  await prisma.cuttingOrder.create({
    data: {
      id,
      orderNo: `ORD-${id}`,
      recipeId: RECIPE_ID,
      targetQty,
      fabricRollId: "FAB-ROLL-882",
      actualFabricYds: opts.fabricYds ?? "91.00",
      createdById: USERS.sup,
    },
  });
  await createItems(id, 1, targetQty);
}

async function createItems(orderId: string, attemptNo: number, targetQty: number) {
  await prisma.verificationItem.createMany({
    data: COMPONENTS.map(([componentId, componentName, pieces]) => ({
      id: `i${attemptNo}_${orderId}_${componentId}`,
      orderId,
      componentId,
      attemptNo,
      componentName,
      expectedQty: targetQty * pieces,
    })),
  });
}

/** Count every item of an attempt as expected, except the given actual quantities per component id. */
export async function countItems(orderId: string, attemptNo: number, actualByComponent: Record<string, number> = {}) {
  const items = await prisma.verificationItem.findMany({ where: { orderId, attemptNo } });
  for (const item of items) {
    const actualQty = actualByComponent[item.componentId] ?? item.expectedQty;
    await prisma.verificationItem.update({
      where: { id: item.id },
      data: { actualQty, status: itemStatus(actualQty, item.expectedQty) },
    });
  }
}

// Fabric snapshot for an approval of the 50-garment order: expected 90.00 yds (1.80 x 50).
export const OVER_CAP_SNAPSHOT = {
  expectedFabricYds: "90.00",
  actualFabricYds: "95.00",
  wastagePct: "5.56",
  wastageCapPct: "5.00",
  overCap: true,
} as const;

/** Insert the APPROVED log, then move the order to VERIFIED (the required operation order). */
export async function approve(orderId: string, attemptNo = 1) {
  await prisma.verificationLog.create({
    data: { orderId, attemptNo, verifierId: USERS.ver, decision: "APPROVED", ...OVER_CAP_SNAPSHOT },
  });
  await prisma.cuttingOrder.update({ where: { id: orderId }, data: { status: "VERIFIED" } });
}

export async function reject(orderId: string, attemptNo = 1, note = "Cuffs short by 1 piece") {
  await prisma.verificationLog.create({
    data: { orderId, attemptNo, verifierId: USERS.ver, decision: "REJECTED", rejectionNote: note },
  });
  await prisma.cuttingOrder.update({ where: { id: orderId }, data: { status: "REJECTED" } });
}

/** Resubmit: bump the attempt on the order first, then insert that attempt's items. */
export async function resubmit(orderId: string) {
  const order = await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: orderId } });
  const attemptNo = order.currentAttempt + 1;
  await prisma.cuttingOrder.update({
    where: { id: orderId },
    data: { status: "PENDING_VERIFICATION", currentAttempt: attemptNo },
  });
  await createItems(orderId, attemptNo, order.targetQty);
  return attemptNo;
}

export async function startSewing(orderId: string) {
  await prisma.cuttingOrder.update({
    where: { id: orderId },
    data: { status: "IN_SEWING", sewingStartedById: USERS.sew, sewingStartedAt: new Date() },
  });
}

/** Order driven to a given state through the legal path. */
export async function orderInState(id: string, state: "PENDING" | "REJECTED" | "VERIFIED" | "IN_SEWING") {
  await createOrder(id);
  if (state === "PENDING") return;
  if (state === "REJECTED") {
    await countItems(id, 1, { c5: 49 * 2 });
    return reject(id);
  }
  await countItems(id, 1);
  await approve(id);
  if (state === "IN_SEWING") await startSewing(id);
}

export const sql = (statement: string) => prisma.$executeRawUnsafe(statement);

/** The statement must fail with exactly this SQLSTATE (GK403/GK409/GK422, 23514, 23505, P0001, ...). */
export async function expectDbError(statement: PromiseLike<unknown>, code: string) {
  const error = await Promise.resolve(statement).then(
    () => undefined,
    (e: unknown) => e ?? new Error("rejected without a reason"),
  );
  expect(error, "statement should have been rejected by the database").toBeDefined();
  expect(sqlStateOf(error)).toBe(code);
}
