/**
 * Database backup: `npm run db:backup [-- <output dir>]` (default ./backups).
 * - SQLite: a consistent online copy via `VACUUM INTO` (safe while the app runs).
 * - PostgreSQL: `pg_dump --format=custom` (needs the PostgreSQL client tools on PATH).
 * The file holds business data and encrypted MDM credentials, never plaintext keys.
 * Restoring credentials also needs the same APP_ENCRYPTION_KEY: back it up separately
 * in your secret manager, not next to the dump. See docs/backup-and-restore.md.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const outDir = path.resolve(process.argv[2] ?? "backups");
mkdirSync(outDir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

async function main() {
  if (url!.startsWith("postgres")) {
    const file = path.join(outDir, `cod-flow-tracker-${stamp}.dump`);
    const r = spawnSync("pg_dump", ["--format=custom", "--no-owner", "--file", file, url!], { stdio: ["ignore", "inherit", "inherit"] });
    if (r.status !== 0) throw new Error("pg_dump failed (is it installed and on PATH?)");
    return file;
  }
  if (!url!.startsWith("file:")) throw new Error("Unsupported DATABASE_URL: expected file: (SQLite) or postgresql://");
  const file = path.join(outDir, `cod-flow-tracker-${stamp}.db`);
  if (/'/.test(file)) throw new Error("Backup path must not contain quotes");
  const db = new PrismaClient();
  try {
    await db.$executeRawUnsafe(`VACUUM INTO '${file}'`);
  } finally {
    await db.$disconnect();
  }
  return file;
}

main()
  .then((file) => console.log(`Backup written: ${file} (${Math.round(statSync(file).size / 1024)} KB)`))
  .catch((e) => {
    console.error(`Backup failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
