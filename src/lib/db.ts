import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@/generated/prisma/client";

// Turbopack rewrites `import.meta.url` in the generated client to a fake /ROOT path, and the build
// directory baked in by `prisma generate` does not exist inside a Vercel function, so Prisma never
// searches the folder where the traced engine file actually lands. It does search /tmp/prisma-engines,
// so copy the Linux engine there once per cold start. (Setting PRISMA_QUERY_ENGINE_LIBRARY instead does
// not work: the bundler strips the assignment, and it also folds a `process.platform` check at build time.)
if (process.env.NODE_ENV === "production") {
  const from = path.join(process.cwd(), "src/generated/prisma");
  const to = "/tmp/prisma-engines";
  try {
    fs.mkdirSync(to, { recursive: true });
    for (const file of fs.readdirSync(from)) {
      const target = path.join(to, file);
      if (/^libquery_engine-.*\.so\.node$/.test(file) && !fs.existsSync(target)) {
        fs.copyFileSync(path.join(from, file), target);
      }
    }
  } catch {
    // Prisma reports a clear "could not locate the Query Engine" error if the engine is really missing.
  }
}

// Cached on globalThis so `next dev` hot reloads do not open a new connection pool each time.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
