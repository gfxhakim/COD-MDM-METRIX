# COD Flow Tracker

Multi-tenant analytics for Cash-on-Delivery e-commerce. It answers one question: **which products and Meta creatives produce delivered profit**, not just cheap leads or placed orders.

Modular monolith: Next.js 16 (App Router) · TypeScript · Tailwind v4 · Radix UI · tRPC v11 · Zod · Prisma (SQLite in dev, PostgreSQL-compatible schema) · Vitest.

## Quick start

```bash
npm install                     # also runs prisma generate
cp .env.example .env            # then set APP_ENCRYPTION_KEY and PII_HASH_SALT
npx prisma migrate dev          # creates prisma/dev.db
npm run db:seed                 # synthetic DEMO workspaces
npm run dev                     # http://localhost:3000
npm test                        # unit + integration tests (uses prisma/test.db)
npm run test:e2e                # Playwright: the 11 critical flows on a production build
npm run test:postgres           # the same unit/integration suite on PostgreSQL (TEST_DATABASE_URL=…_test)
```

Demo logins (development only, synthetic data, labelled **DEMO DATA** in the UI):

| Email | Password | Workspace | Role |
|---|---|---|---|
| demo@codflow.local | demo-password-123 | Demo · Atlas Gadgets | Owner |
| analyst@codflow.local | demo-password-123 | Demo · Atlas Gadgets | Analyst |
| other@codflow.local | other-password-123 | Demo · Other Business | Owner |

## MDM Express credentials: one per workspace

There is **no global MDM key**. Each business enters its own MDM Express API key in
**Settings → MDM Express**. The key is encrypted at rest with
AES-256-GCM using `APP_ENCRYPTION_KEY`, decrypted only inside server-side integration code, and never
returned to the browser, logged, or written to the audit log. The browser only sees status, masked
last-four and timestamps. `MDM_API_KEY` in `.env.example` is a placeholder for an optional local
contract-check script and is never read by the application.

## Architecture

```
prisma/schema.prisma           30 tables; money = integer minor units + currency (default DZD)
prisma/seed.ts                 synthetic demo workspaces
src/domain/                    pure, tested business logic (economics engine, simulator, cost versions, status mapping)
src/server/reports/            loads stored facts per workspace and runs the engine (dashboard, matrix)
src/lib/                       money, normalization, PII hashing, permissions (client-safe)
src/server/tenancy.ts          WorkspaceContext + membership resolution + role checks
src/server/repositories/       every method takes a WorkspaceContext and filters by workspaceId
src/server/trpc/               typed procedures; Zod input validation; sanitized errors
src/app/(auth)/                sign in / sign up (server actions, rate limited)
src/app/(app)/                 dashboard, products, orders, expenses, settings, …
tests/                         unit + integration tests (tenant isolation, roles, history)
```

### Tenant isolation

* The browser may *request* a workspace (`x-workspace-id` header or `cft_ws` cookie). The server
  always resolves it through `workspace_members`; a requested workspace without membership is rejected
  with `FORBIDDEN`.
* Repository methods cannot be called without a `WorkspaceContext`, and every query includes
  `workspaceId`. Looking up another tenant's record by id returns `NOT_FOUND`.
* Covered by `tests/integration/tenant-isolation.test.ts`.

### Security baseline

* Sessions: random 256-bit token in an httpOnly, SameSite=Lax cookie (Secure in production); only
  its SHA-256 hash is stored.
* Passwords: scrypt with per-user salt. Login/signup are rate limited (DB-backed buckets).
* CSRF: SameSite cookies plus an Origin check on every non-GET tRPC request.
* Headers: CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, HSTS in production.
* PII: phone numbers are stored only as a per-workspace salted hash plus a mask (`•••• 456`).
* Audit log for role changes, deletions, cost versions, manual parcel matches, credential changes,
  syncs (including scheduled ones) and imports. Metadata is recursively scrubbed of secret-looking keys.
* Production start refuses placeholder or weak secrets; `/api/health` for monitors; expired sessions
  and rate-limit rows are cleaned up hourly.

## Production

* [Step-by-step deployment for beginners](docs/deploy-step-by-step.md) (Railway example).
* [Deployment](docs/deployment.md): PostgreSQL, environment, scheduled sync options (built in,
  worker, or external cron), how each customer adds their own MDM key, key rotation, updates.
* [Backup and restore](docs/backup-and-restore.md): `npm run db:backup`, restore steps, drills.

## Milestones

1. ✅ Scaffold, auth, workspaces & roles, schema/migrations, dark shell, demo seed, products/orders/expenses CRUD
2. ✅ Economics engine, dashboard profit metrics, breakeven simulator, creative matrix
3. ✅ CSV import wizards, attribution normalization, spend matching, import errors
4. ✅ Secure MDM settings, read-only connection test, async sync, status history, unmatched review
   (live adapter built from MDM's OpenAPI schema; unverified until a real key passes the test)
5. ✅ Scheduled sync, hardening, Playwright E2E, deployment + backup/restore docs
