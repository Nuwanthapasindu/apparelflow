import { z } from "zod";

export const ACTUAL_QTY_MAX = 10_000_000;
export const COUNTS_MAX = 50;
export const REJECTION_NOTE_MAX = 1_000;
const ACTUAL_QTY_TEXT = /^\d{1,8}$/;

export function parseActualQtyText(text: string): { value: number } | { error: string } {
  if (!ACTUAL_QTY_TEXT.test(text)) return { error: `Enter a whole number from 0 to ${ACTUAL_QTY_MAX.toLocaleString("en-US")}` };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value > ACTUAL_QTY_MAX) {
    return { error: `Enter a whole number from 0 to ${ACTUAL_QTY_MAX.toLocaleString("en-US")}` };
  }
  return { value };
}

const componentId = z.string().uuid("Choose a valid component");

export const orderActionParamsSchema = z.strictObject({
  id: z.string().uuid("Enter a valid order id"),
});

const countRowSchema = z.strictObject({
  componentId,
  actualQty: z
    .number({ error: `Enter a whole number from 0 to ${ACTUAL_QTY_MAX.toLocaleString("en-US")}` })
    .int(`Enter a whole number from 0 to ${ACTUAL_QTY_MAX.toLocaleString("en-US")}`)
    .min(0, "Count cannot be negative")
    .max(ACTUAL_QTY_MAX, `Count cannot exceed ${ACTUAL_QTY_MAX.toLocaleString("en-US")}`),
});

export const saveCountsSchema = z.strictObject({
  counts: z
    .array(countRowSchema)
    .min(1, "Enter at least one component count")
    .max(COUNTS_MAX, `Save no more than ${COUNTS_MAX} component counts at once`)
    .superRefine((rows, ctx) => {
      const first = new Map<string, number>();
      rows.forEach((row, index) => {
        const previous = first.get(row.componentId);
        if (previous === undefined) first.set(row.componentId, index);
        else {
          ctx.addIssue({ code: "custom", path: [index, "componentId"], message: "Component appears more than once" });
          ctx.addIssue({ code: "custom", path: [previous, "componentId"], message: "Component appears more than once" });
        }
      });
    }),
});

export const emptyActionSchema = z.strictObject({});

export const rejectOrderSchema = z.strictObject({
  note: z
    .string({ error: "Enter a rejection reason" })
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1, "Enter a rejection reason")
        .max(REJECTION_NOTE_MAX, `Use ${REJECTION_NOTE_MAX} characters or fewer`)
        .refine((value) => !value.includes("\u0000"), "The rejection reason contains an unsupported character"),
    ),
});

export type SaveCountsInput = z.output<typeof saveCountsSchema>;
export type RejectOrderInput = z.output<typeof rejectOrderSchema>;
