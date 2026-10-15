import net from "node:net";

const SETUP_HELP = [
  "To set up the throwaway test database:",
  "  cp .env.test.example .env.test",
  "  yarn test:db:up",
  "  yarn test:db:migrate",
].join("\n");

// Tests end with TRUNCATE ... CASCADE, so refuse to run against anything but a local test database.
export function assertTestDatabase(env: Record<string, string | undefined> = process.env): void {
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const raw = env[name];
    if (!raw) {
      throw new Error(`${name} is not set. "yarn test" loads it from .env.test, which is missing or incomplete.\n${SETUP_HELP}`);
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`${name} is not a valid URL; refusing to run tests.`);
    }
    const database = url.pathname.replace(/^\//, "");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !database.includes("test")) {
      throw new Error(
        `Refusing to run tests: ${name} must point at a local database whose name contains "test" ` +
          `(got host "${url.hostname}", database "${database}").`,
      );
    }
  }
}

/** Fails fast with the setup commands when nothing is listening, instead of hundreds of connection errors. */
export function assertDatabaseReachable(env: Record<string, string | undefined> = process.env, timeoutMs = 3000): Promise<void> {
  const url = new URL(env.DATABASE_URL ?? "");
  const host = url.hostname;
  const port = Number(url.port || 5432);
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const fail = () => {
      socket.destroy();
      reject(new Error(`Cannot reach the test database at ${host}:${port}.\n${SETUP_HELP}`));
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", fail);
    socket.once("timeout", fail);
  });
}
