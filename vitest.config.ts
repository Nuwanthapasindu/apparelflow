import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// The concurrency tests hold several transactions open at once, so the pool must allow at least 10
// connections whatever the CPU count of the machine (Prisma's default is cpu * 2 + 1).
const withPool = (url?: string) =>
  url && !url.includes("connection_limit") ? `${url}${url.includes("?") ? "&" : "?"}connection_limit=10` : url;
const poolEnv = process.env.DATABASE_URL ? { DATABASE_URL: withPool(process.env.DATABASE_URL)! } : {};

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    env: poolEnv,
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    // All tests share one database and truncate it, so files must run one at a time.
    fileParallelism: false,
  },
});
