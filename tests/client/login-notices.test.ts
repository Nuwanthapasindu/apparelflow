import { describe, expect, it } from "vitest";
import { noticeFor } from "@/lib/login-notices";

describe("login notices (the query string cannot inject or crash anything)", () => {
  it("maps known reasons to fixed text", () => {
    expect(noticeFor("switch-failed")).toMatch(/signed out/);
  });

  it.each(["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf", "<script>alert(1)</script>", "", "SWITCH-FAILED", "unknown"])(
    "ignores %j",
    (reason) => expect(noticeFor(reason)).toBeUndefined(),
  );

  it("ignores missing and repeated values", () => {
    expect(noticeFor(undefined)).toBeUndefined();
    expect(noticeFor(["switch-failed", "x"])).toBeUndefined();
  });
});
