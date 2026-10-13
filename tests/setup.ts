import { afterAll, beforeEach } from "vitest";
import { assertTestDatabase } from "./helpers/assert-test-database";
import { prisma, resetDb } from "./helpers/db";

assertTestDatabase();

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());
