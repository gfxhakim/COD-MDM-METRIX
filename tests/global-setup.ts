import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

/** Fresh throwaway SQLite file per run: delete it, then apply migrations (non-destructive deploy). */
export default function setup() {
  for (const f of ["test.db", "test.db-journal"]) rmSync(path.join(__dirname, "..", "prisma", f), { force: true });
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: "file:./test.db", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "pipe",
  });
}
