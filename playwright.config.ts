import { defineConfig } from "@playwright/test";

// Two modes:
//  - default: builds and starts the app on a local port against the TEST database (see tests/e2e/prepare.ts).
//  - BASE_URL=https://...: drives an already running deployment. That creates data there (see README).
const PORT = Number(process.env.E2E_PORT ?? 3200);
const remote = process.env.BASE_URL;
const baseURL = remote ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  // The tests share one database and one demo user set, so they run one after another.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    // PW_CHANNEL=chrome uses the Chrome installed on this machine instead of Playwright's own Chromium.
    channel: process.env.PW_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  ...(remote
    ? {}
    : {
        webServer: {
          // The demo flag is read at build time, so the build happens here, with the test database env.
          command: `NEXT_PUBLIC_DEMO_MODE=true next build && next start -p ${PORT}`,
          url: `${baseURL}/login`,
          timeout: 240_000,
          reuseExistingServer: false,
        },
      }),
});
