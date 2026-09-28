import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

/**
 * Fresh database per run.
 * - SQLite (default): delete prisma/test.db, then apply migrations.
 * - PostgreSQL (`npm run test:postgres`, TEST_DATABASE_URL=postgresql://…): drop and
 *   re-create the public schema from prisma/postgres/migrations. Only a database named *_test is accepted.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "file:./test.db";
  const env = { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" };
  if (url.startsWith("postgres")) {
    // Guard: this wipes the schema, so it only runs against a database whose name ends in "_test".
    const dbName = new URL(url).pathname.slice(1);
    if (!dbName.endsWith("_test")) throw new Error(`TEST_DATABASE_URL must point at a throwaway database named *_test (got "${dbName}")`);
    execSync("npx prisma db execute --stdin --schema prisma/postgres/schema.prisma", { env, input: "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;", stdio: ["pipe", "pipe", "pipe"] });
    execSync("npx prisma migrate deploy --schema prisma/postgres/schema.prisma", { env, stdio: "pipe" });
    return;
  }
  for (const f of ["test.db", "test.db-journal"]) rmSync(path.join(__dirname, "..", "prisma", f), { force: true });
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
}
