import net from "node:net";
import { describe, expect, it } from "vitest";
import { assertDatabaseReachable, assertTestDatabase } from "../helpers/assert-test-database";

const local = "postgresql://postgres:test@localhost:5433/apparelflow_test";

describe("assertTestDatabase", () => {
  it("accepts a local database whose name contains test", () => {
    expect(() => assertTestDatabase({ DATABASE_URL: local, DIRECT_URL: local })).not.toThrow();
  });

  it("names the setup commands when a URL is missing", () => {
    expect(() => assertTestDatabase({ DIRECT_URL: local })).toThrow(/cp \.env\.test\.example \.env\.test[\s\S]*yarn test:db:up/);
  });

  it("refuses a remote host", () => {
    const remote = "postgresql://postgres:x@db.example.supabase.co:5432/apparelflow_test";
    expect(() => assertTestDatabase({ DATABASE_URL: remote, DIRECT_URL: local })).toThrow(/Refusing to run tests/);
  });

  it("refuses a local database whose name does not contain test", () => {
    const real = "postgresql://postgres:x@localhost:5432/postgres";
    expect(() => assertTestDatabase({ DATABASE_URL: local, DIRECT_URL: real })).toThrow(/Refusing to run tests/);
  });

  it("refuses a value that is not a URL", () => {
    expect(() => assertTestDatabase({ DATABASE_URL: "not a url", DIRECT_URL: local })).toThrow(/not a valid URL/);
  });
});

describe("assertDatabaseReachable", () => {
  it("resolves when something is listening", async () => {
    const server = net.createServer().listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      await expect(assertDatabaseReachable({ DATABASE_URL: `postgresql://u:p@127.0.0.1:${port}/x_test` })).resolves.toBeUndefined();
    } finally {
      server.close();
    }
  });

  it("rejects with the setup commands when nothing is listening", async () => {
    const server = net.createServer().listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as net.AddressInfo;
    await new Promise((resolve) => server.close(resolve));
    await expect(assertDatabaseReachable({ DATABASE_URL: `postgresql://u:p@127.0.0.1:${port}/x_test` })).rejects.toThrow(
      /Cannot reach the test database at 127\.0\.0\.1:\d+[\s\S]*yarn test:db:up/,
    );
  });
});
