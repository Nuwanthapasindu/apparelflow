// Pure form logic for the order modal, so it is testable without a browser. Uses the same checks
// as the server (./order), so what the form accepts is what the API accepts.
import { expectedCounts } from "@/lib/domain/components";
import {
  checkFabricRollId,
  checkFabricYds,
  checkRecipeId,
  parseTargetQtyText,
} from "./order";

export type OrderFormValues = { recipeId: string; targetQty: string; fabricRollId: string; actualFabricYds: string };
export type OrderFormField = keyof OrderFormValues;
export type OrderFormErrors = Partial<Record<OrderFormField, string>>;
export type OrderPayload = { recipeId: string; targetQty: number; fabricRollId: string; actualFabricYds: string };

/** Display and submit order of the fields (also the order focus moves in). */
export const ORDER_FORM_FIELDS: OrderFormField[] = ["recipeId", "targetQty", "fabricRollId", "actualFabricYds"];

export const EMPTY_ORDER_FORM: OrderFormValues = { recipeId: "", targetQty: "", fabricRollId: "", actualFabricYds: "" };

export function validateOrderField(field: OrderFormField, values: OrderFormValues): string | undefined {
  switch (field) {
    case "recipeId":
      return checkRecipeId(values.recipeId) ?? undefined;
    case "targetQty": {
      const parsed = parseTargetQtyText(values.targetQty);
      return "error" in parsed ? parsed.error : undefined;
    }
    case "fabricRollId":
      return checkFabricRollId(values.fabricRollId) ?? undefined;
    case "actualFabricYds":
      return checkFabricYds(values.actualFabricYds.trim()) ?? undefined;
  }
}

/** All errors at once, plus the payload to send when there are none. */
export function validateOrderForm(values: OrderFormValues): { errors: OrderFormErrors; payload?: OrderPayload } {
  const errors: OrderFormErrors = {};
  for (const field of ORDER_FORM_FIELDS) {
    const message = validateOrderField(field, values);
    if (message) errors[field] = message;
  }
  if (Object.keys(errors).length) return { errors };

  const qty = parseTargetQtyText(values.targetQty);
  if ("error" in qty) return { errors: { targetQty: qty.error } };
  return {
    errors,
    payload: {
      recipeId: values.recipeId,
      targetQty: qty.value,
      fabricRollId: values.fabricRollId.trim(),
      actualFabricYds: values.actualFabricYds.trim(),
    },
  };
}

/** Server `fields` keys that have an input; anything else goes in the banner. */
export function splitServerFields(fields: Record<string, string> | undefined): { mapped: OrderFormErrors; other: string[] } {
  const mapped: OrderFormErrors = {};
  const other: string[] = [];
  for (const [key, message] of Object.entries(fields ?? {})) {
    if ((ORDER_FORM_FIELDS as string[]).includes(key)) mapped[key as OrderFormField] = message;
    else other.push(message);
  }
  return { mapped, other };
}

/**
 * Live expected-count preview: null until the quantity is a valid number, so an empty or invalid
 * input shows a neutral hint and never a table of zeros. Display only: the server recomputes.
 */
export function previewCounts(
  components: readonly { id: string; componentName: string; piecesPerGarment: number }[] | undefined,
  targetQtyText: string,
) {
  if (!components) return null;
  const qty = parseTargetQtyText(targetQtyText);
  if ("error" in qty) return null;
  return expectedCounts(components, qty.value);
}
