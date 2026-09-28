// Generates prisma/postgres/schema.prisma from prisma/schema.prisma (the source of truth),
// switching only the datasource provider. Run with `npm run db:pg:schema`.
// With --check it fails if the committed copy is out of date (use in CI).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const src = readFileSync("prisma/schema.prisma", "utf8");
const out =
  "// GENERATED from prisma/schema.prisma by scripts/postgres-schema.mjs. Do not edit by hand.\n" +
  src.replace(/provider = "sqlite"/, 'provider = "postgresql"');
if (out === src || !out.includes('provider = "postgresql"')) throw new Error("Could not switch the datasource provider");
if (process.argv.includes("--check")) {
  const current = readFileSync("prisma/postgres/schema.prisma", "utf8");
  if (current !== out) {
    console.error("prisma/postgres/schema.prisma is out of date: run npm run db:pg:schema and create a PostgreSQL migration.");
    process.exit(1);
  }
} else {
  mkdirSync("prisma/postgres", { recursive: true });
  writeFileSync("prisma/postgres/schema.prisma", out);
  console.log("Wrote prisma/postgres/schema.prisma");
}
