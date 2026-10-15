// Prepares the TEST database for the Playwright run: guard, migrate, seed, then remove leftover orders.
// Run through `yarn e2e` (which loads .env.test). Refuses anything that is not a local test database.
import { execFileSync } from "node:child_process";
import { assertTestDatabase } from "../helpers/assert-test-database";
import { PrismaClient } from "../../src/generated/prisma/client";

if (process.env.BASE_URL) {
  console.log(`BASE_URL is set (${process.env.BASE_URL}): skipping local database preparation.`);
  console.log("This run drives the deployment and CREATES DATA there; it is not cleaned up automatically.");
  process.exit(0);
}

assertTestDatabase();
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set (32+ characters) in .env.test, so the local server never falls back to a real secret.');
}

const bin = (name: string) => `${process.cwd()}/node_modules/.bin/${name}`;
const env = { ...process.env, PATH: `${process.cwd()}/node_modules/.bin:${process.env.PATH}` };
const host = new URL(process.env.DATABASE_URL!).host;

console.log(`Preparing the test database at ${host}`);
execFileSync(bin("prisma"), ["migrate", "deploy"], { stdio: "inherit", env });
execFileSync(bin("prisma"), ["db", "seed"], { stdio: "inherit", env });

async function removeOrders() {
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe("TRUNCATE verification_logs, verification_items, cutting_orders CASCADE");
    await prisma.$executeRawUnsafe("ALTER SEQUENCE cutting_order_no_seq RESTART WITH 1");
  } finally {
    await prisma.$disconnect();
  }
}

removeOrders().then(
  () => console.log("Test database is migrated, seeded and has no orders."),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
