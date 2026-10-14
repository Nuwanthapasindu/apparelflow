import { describe, expect, it } from "vitest";
import { APP_TIMEZONE, formatDateTime, formatInt } from "@/lib/format";
import {
  EMPTY_ORDER_FORM,
  ORDER_FORM_FIELDS,
  previewCounts,
  splitServerFields,
  validateOrderField,
  validateOrderForm,
  type OrderFormValues,
} from "@/lib/validation/order-form";
import { createOrderSchema } from "@/lib/validation/order";

const good: OrderFormValues = { recipeId: "r1", targetQty: "50", fabricRollId: " FAB-ROLL-882 ", actualFabricYds: " 91.5 " };
const blouse = [
  { id: "c1", componentName: "Front Body Panel", piecesPerGarment: 1 },
  { id: "c2", componentName: "Sleeve Cuffs", piecesPerGarment: 2 },
];

describe("order form validation", () => {
  it("accepts good values and builds the payload the server expects", () => {
    const { errors, payload } = validateOrderForm(good);
    expect(errors).toEqual({});
    expect(payload).toEqual({ recipeId: "r1", targetQty: 50, fabricRollId: "FAB-ROLL-882", actualFabricYds: "91.5" });
    expect(createOrderSchema.parse(payload)).toMatchObject({ targetQty: 50, actualFabricYds: "91.50" });
  });

  it("reports every empty field on an empty form", () => {
    const { errors, payload } = validateOrderForm(EMPTY_ORDER_FORM);
    expect(Object.keys(errors)).toEqual(ORDER_FORM_FIELDS);
    expect(payload).toBeUndefined();
  });

  it.each(["", " ", "0", "-1", "5.5", "1e3", "abc", "100001", "5 0", "٥"])("rejects target quantity %j", (targetQty) => {
    expect(validateOrderField("targetQty", { ...good, targetQty })).toEqual(expect.any(String));
  });

  it.each(["", " ", "0", "0.00", "-1", "1e3", "12.345", "abc", "1,5", "007", "1000000", ".5"])("rejects yards %j", (actualFabricYds) => {
    expect(validateOrderField("actualFabricYds", { ...good, actualFabricYds })).toEqual(expect.any(String));
  });

  it.each(["", " ", "AB", "FAB ROLL", "-X1", "<script>"])("rejects roll id %j", (fabricRollId) => {
    expect(validateOrderField("fabricRollId", { ...good, fabricRollId })).toEqual(expect.any(String));
  });

  it("anything the form accepts, the server schema accepts too (no drift)", () => {
    const samples = ["1", "50", "100000", "007"];
    const yards = ["1", "12.5", "12.50", "0.01", "999999.99", " 7 "];
    const rolls = ["FAB-1", "a.b_c", "  XYZ  ", "x".repeat(40)];
    for (const targetQty of samples) for (const actualFabricYds of yards) for (const fabricRollId of rolls) {
      const { payload } = validateOrderForm({ recipeId: "r", targetQty, actualFabricYds, fabricRollId });
      expect(payload, JSON.stringify({ targetQty, actualFabricYds, fabricRollId })).toBeDefined();
      expect(createOrderSchema.safeParse(payload).success).toBe(true);
    }
  });

  it("and what the form rejects, the server schema rejects too", () => {
    for (const bad of [{ targetQty: "0" }, { actualFabricYds: "0.00" }, { fabricRollId: "AB" }, { recipeId: "" }]) {
      const values = { ...good, ...bad };
      expect(validateOrderForm(values).payload).toBeUndefined();
      expect(createOrderSchema.safeParse({ recipeId: values.recipeId, targetQty: Number(values.targetQty), fabricRollId: values.fabricRollId, actualFabricYds: values.actualFabricYds }).success).toBe(false);
    }
  });

  it("maps server field errors onto inputs and sends the rest to the banner", () => {
    expect(splitServerFields({ targetQty: "bad", recipeId: "unknown", _: "general", status: "Unknown field" })).toEqual({
      mapped: { targetQty: "bad", recipeId: "unknown" },
      other: ["general", "Unknown field"],
    });
    expect(splitServerFields(undefined)).toEqual({ mapped: {}, other: [] });
  });
});

describe("live expected-count preview", () => {
  it("multiplies pieces per garment by the quantity", () => {
    expect(previewCounts(blouse, "50")?.map((c) => [c.componentName, c.expectedQty])).toEqual([
      ["Front Body Panel", 50],
      ["Sleeve Cuffs", 100],
    ]);
  });

  it("is null (a neutral hint, never zeros) for empty, invalid or missing input", () => {
    for (const text of ["", " ", "0", "abc", "-5", "5.5", "1e3", "100001"]) expect(previewCounts(blouse, text), text).toBeNull();
    expect(previewCounts(undefined, "50")).toBeNull();
  });

  it("updates as the quantity changes", () => {
    expect(previewCounts(blouse, "5")?.[1].expectedQty).toBe(10);
    expect(previewCounts(blouse, "500")?.[1].expectedQty).toBe(1000);
    expect(previewCounts(blouse, "100000")?.[1].expectedQty).toBe(200_000);
  });
});

describe("time and number display", () => {
  it("shows UTC timestamps in the plant's timezone", () => {
    expect(APP_TIMEZONE).toBe("Asia/Colombo");
    expect(formatDateTime("2026-10-14T04:30:00.000Z")).toBe("14 Oct 2026, 10:00"); // UTC+05:30
    expect(formatDateTime("2026-10-14T20:00:00.000Z")).toBe("15 Oct 2026, 01:30"); // crosses midnight
  });

  it("does not throw on a bad timestamp", () => {
    expect(formatDateTime("not a date")).toBe("-");
  });

  it("groups thousands with a fixed locale", () => {
    expect(formatInt(100000)).toBe("100,000");
    expect(formatInt(50)).toBe("50");
  });
});
