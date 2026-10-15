import { assertDatabaseReachable, assertTestDatabase } from "./helpers/assert-test-database";

export default async function setup() {
  assertTestDatabase();
  await assertDatabaseReachable();
}
