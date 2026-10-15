import { describe, expect, it, vi } from "vitest";
import { readAfterCommit } from "@/lib/services/after-commit";

describe("readAfterCommit", () => {
  it("returns the first result without a second read", async () => {
    const read = vi.fn().mockResolvedValue("detail");
    await expect(readAfterCommit(read)).resolves.toBe("detail");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("retries once after a transient failure", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("connection reset")).mockResolvedValue("detail");
    await expect(readAfterCommit(read)).resolves.toBe("detail");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("gives up after the second failure and passes that error on", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("first")).mockRejectedValueOnce(new Error("second"));
    await expect(readAfterCommit(read)).rejects.toThrow("second");
    expect(read).toHaveBeenCalledTimes(2);
  });
});
