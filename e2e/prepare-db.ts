/**
 * Fresh seeded database for every E2E run (prisma/e2e.db). Runs as the first step of
 * the Playwright web server command, before the app opens the database file.
 */
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

if (process.env.DATABASE_URL !== "file:./e2e.db") throw new Error("prepare-db only runs against file:./e2e.db");
for (const f of ["e2e.db", "e2e.db-journal"]) rmSync(path.join(__dirname, "..", "prisma", f), { force: true });
const env = { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" };
execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
console.log("[e2e] database ready");
