// Tests end with TRUNCATE ... CASCADE, so refuse to run against anything but a local test database.
export function assertTestDatabase(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const raw = env[name];
    if (!raw) {
      throw new Error(`${name} is not set. Run the tests with "yarn test" so .env.test is loaded.`);
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
