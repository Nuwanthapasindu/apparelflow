import type { Prisma } from "@/generated/prisma/client";
import { expectedQty } from "@/lib/domain/components";

/**
 * One uncounted row per recipe component for an attempt. `expectedQty` and `componentName` are
 * snapshots, so later recipe edits never change history. Reused by resubmit (next attempt).
 */
export async function insertAttemptItems(
  tx: Prisma.TransactionClient,
  args: {
    orderId: string;
    attemptNo: number;
    targetQty: number;
    components: { id: string; componentName: string; piecesPerGarment: number }[];
  },
) {
  await tx.verificationItem.createMany({
    data: args.components.map((c) => ({
      orderId: args.orderId,
      componentId: c.id,
      attemptNo: args.attemptNo,
      componentName: c.componentName,
      expectedQty: expectedQty(c.piecesPerGarment, args.targetQty),
      // actualQty and status stay NULL: "uncounted" until a verifier counts
    })),
  });
}
