# Milestone 5 report: scheduled sync, hardening, E2E, deployment and backups

## Status, first

Milestone 5 is complete, and with it the five milestones in the spec. All three test suites pass:
- 153 unit and integration tests on SQLite
- the same 153 on a real PostgreSQL 16 server
- all 11 Playwright flows the spec lists, on a production build

**Still open from Milestone 4:** the live MDM adapter has not been tried against a real MDM
account. It is built from MDM's OpenAPI schema, but no real key has been used. It is proven only
when the owner enters their own key in a deployed copy and the connection test passes.

**Scheduled sync design:** hosting-neutral. The scheduling logic is one function, called from any
of three places:
1. inside the web server, every minute (the default)
2. a separate worker process (`npm run sync:worker`)
3. an external cron that calls `POST /api/cron/sync` with `Authorization: Bearer $CRON_SECRET`

A per-workspace database lock means running several of these at once never double-syncs.

Nothing was deployed, no accounts were created, and nothing was pushed.

## 1. Files changed

**New:**
- `src/server/mdm/schedule.ts`
  - `scheduleDueSyncs` queues an incremental sync for each connected workspace whose interval has passed since its last sync, manual or scheduled. A system audit entry is written for each.
  - `cleanupExpired` deletes expired sessions and old rate-limit windows.
- `src/server/cron.ts`: constant-time bearer check for `CRON_SECRET`. The endpoint is disabled (404) when the secret is unset.
- `src/app/api/cron/sync/route.ts`: the external scheduler hook, GET or POST.
  - Queues due syncs and answers `202` at once, with the jobs running in the background.
  - With `SYNC_BACKGROUND=off` it runs them inside the request instead, for serverless hosts.
- `src/app/api/health/route.ts`: `200 {"status":"ok"}` or `503`, with a database check and nothing else revealed.
- `src/server/config.ts`: production start-up checks.
  - Refuses a missing, placeholder or wrong-length `APP_ENCRYPTION_KEY`, a weak `PII_HASH_SALT`, a short `CRON_SECRET`, and a real-looking `MDM_API_KEY`.
  - Messages name the variable, never its value.
- `src/server/crypto/rotate.ts` and `scripts/reencrypt-credentials.ts` (`npm run secrets:reencrypt`): re-encrypt every stored MDM credential with a new key, so the old key can be retired without customers re-entering keys. Prints counts only.
- `scripts/postgres-schema.mjs`: generates `prisma/postgres/schema.prisma` from the SQLite schema. `--check` fails when the copy is stale.
- `prisma/postgres/schema.prisma` and `prisma/postgres/migrations/20260926190000_init`: the PostgreSQL schema and its baseline migration.
- `scripts/backup.ts` (`npm run db:backup`): `pg_dump --format=custom` for PostgreSQL, or `VACUUM INTO` for SQLite.
- `playwright.config.ts`, `e2e/prepare-db.ts`, `e2e/critical-flows.spec.ts`, and `e2e/fixtures/*.csv`: the browser test suite.
- `tests/integration/schedule-and-hardening.test.ts`
- `docs/deployment.md`, `docs/backup-and-restore.md`, and this report.

**Changed:**
- `src/server/mdm/sync.ts`: `enqueueSync` is split out of `startSync`, so the scheduler can queue jobs without a user. Role checks and rate limits stay on the user path.
- `src/server/mdm/runner.ts`
  - `runSchedulerTick` schedules, processes due jobs, and cleans up hourly.
  - The poller no longer starts a second pass while one is still running.
- `scripts/sync-worker.ts`: runs the full scheduler tick and checks the production config.
- `src/instrumentation.ts`: validates the config and exits with the reason instead of leaving a half-started server.
- `src/server/rateLimit.ts`: each step is now one atomic statement. Concurrent requests can no longer slip past the limit.
- `tests/global-setup.ts` and `vitest.config.mts`: the suite runs on PostgreSQL when `TEST_DATABASE_URL` points at a database named `*_test`, and refuses any other name.
- UI:
  - Settings explains that syncs run automatically at the chosen interval.
  - The sync page shows "Syncs automatically every N min" once the connection passes its test.
- `package.json`: adds `test:e2e`, `test:postgres`, `db:pg:schema`, `db:pg:generate`, `db:pg:deploy`, `db:backup` and `secrets:reencrypt`.
- `.env.example`: adds `SYNC_SCHEDULER` and `CRON_SECRET`.
- `README.md`: adds the milestones, test commands and links to the production docs.

## 2. Database changes

- The development schema has no changes and no new SQLite migration.
- New: a PostgreSQL copy of the schema, plus one baseline migration that creates every table, enum and index.
  - Checked by applying it to PostgreSQL 16, running the demo seed (65 orders, 50 parcels), and running the whole test suite against it.
- Scheduled jobs use the existing `SyncTrigger.SCHEDULED`, with `requestedById` null. Their audit entries have `actorUserId` null and action `sync.scheduled`.

## 3. Features completed

**Scheduled sync.**
- Each connected workspace syncs incrementally every N minutes. The default is 45, and owners can set 15 minutes to 24 hours.
- A manual sync resets the clock.
- Workspaces whose connection is in error, or whose key was removed, are skipped.
- One workspace's failure doesn't stop the others.
- Up to 200 workspaces are handled per pass, least recently synced first.
- Interrupted syncs resume from their last saved page, as in Milestone 4.

**Hardening.**
- A health endpoint.
- Production config validation that fails fast.
- A concurrency-safe rate limiter.
- Hourly cleanup of expired sessions and rate-limit rows.
- A protected, disabled-by-default cron endpoint.
- An operator key-rotation tool.
- Headers were checked on the production build: CSP, `X-Frame-Options: DENY`, HSTS and `Referrer-Policy`.

Already in place from earlier milestones, and re-verified:
- `SameSite`/`Secure`/`HttpOnly` cookies and the Origin check on mutations
- upload size limits
- CSV formula-injection escaping on export
- the SSRF allowlist
- encrypted per-workspace credentials

**PostgreSQL.**
- A production schema and migration, generated from the development schema so the two can't drift silently.
- `npm run test:postgres` runs the whole suite on PostgreSQL.

**Backups.**
- `npm run db:backup` for both databases.
- A documented restore, and a restore drill done on both.

**Docs.**
- `docs/deployment.md` covers:
  - requirements and every environment variable
  - first deploy, HTTPS and process-manager examples, the health check
  - the three scheduling options
  - step-by-step instructions for how each customer adds their own MDM key
  - key rotation, updates, schema changes, and a go-live checklist
- `docs/backup-and-restore.md` covers:
  - what to back up, including keeping the encryption key apart from the dumps
  - schedule and commands, restore for both databases, and checks after a restore
  - drills, and what happens if the key is lost

## 4. Tests added and results

**`tests/integration/schedule-and-hardening.test.ts` (10 tests):**
- Scheduling:
  - queues one job per due workspace, with its audit entry
  - respects the lock and the interval
  - a manual sync pushes the schedule back
  - error or removed connections are skipped
- Cron endpoint:
  - 404 without a secret, 401 with a wrong one
  - a correct call queues the sync and runs it through the live adapter, with MDM stubbed; the key goes only in the MDM header and never appears in the response
- Health check.
- Production config validation.
- The rate limiter under 8 concurrent calls admits exactly 5, and resets after the window.
- Cleanup removes only expired rows.
- Key rotation re-encrypts to the new version, works after the old key is removed, and a second run changes nothing.

**`e2e/critical-flows.spec.ts` (11 Playwright tests, Chromium, production build, fresh seeded database):**
1. Sign up, land in the new workspace, sign out and back in.
2. Import an orders CSV: row errors shown, 3 imported, error CSV offered, and a re-import finds only duplicates.
3. Import a Meta spend CSV: 2 rows.
4. Add a product, then a new cost version that becomes the current one.
5. Add an expense.
6. The creative matrix shows 2 700 DZD of spend and a 900 DZD placed CPA for the imported creative.
7. The breakeven simulator for that product.
8. Configure the demo MDM connection: the key never appears in the page or in any API response.
9. Start a sync and see it finish in the history.
10. Link an unmatched parcel to an order: it moves to Resolved.
11. Another business gets 403 on orders, MDM connection, sync history and expenses for both workspaces, and sees none of their data.

The browser tests run in spec order, except that the product (flow 4) is created before the orders
import (flow 2) so the imported SKU exists. MDM flows 8–10 use the demo workspace's labelled mock
adapter; no request reaches MDM.

**Results:**

| Suite | Result |
|---|---|
| `npm test` (SQLite) | 153 passed, 16 files |
| `npm run test:postgres` (PostgreSQL 16) | 153 passed |
| `npm run test:e2e` | 11 passed, run twice from a clean build |
| ESLint, `tsc`, `next build` | clean |

Also checked by hand:
- A production start with placeholder secrets exits with code 1 and names the variables, not their values.
- The cron endpoint answered 401 without the secret and 202 with it.
- The server log from the E2E run contains no MDM key.

## 5. Known limitations

- **MDM is not proven against a real account** (Milestone 4). Two assumptions need the first real sync to confirm: money units and status names.
- **Cash remittance from MDM is not synced.** The dashboard's "cash remitted" view still relies on data from outside MDM.
- **Tracking-ID search on the Orders page is case-sensitive on PostgreSQL.** SQLite ignores case. Order-number search is normalized, so it is unaffected, and so is matching during sync.
- **Scheduling queries each workspace's last job separately.** That's fine for hundreds of workspaces, not for tens of thousands.
- **In-process background jobs need a long-running server.** On serverless hosts, use the cron's inline mode or the worker, as the deployment doc explains.
- **The E2E suite covers Chromium on desktop only.** Mobile layouts were checked by hand in earlier milestones.
- **Deployment is documented, not performed.** No host was chosen, and no Dockerfile is included.

## 6. Exact next step

1. **Add a GitHub repository** in Project settings, so the code can be pushed and reviewed.
2. **Choose a host** (any Node.js host with PostgreSQL) and deploy with `docs/deployment.md`.
3. In the deployed app, enter your own MDM key in Settings and run **Test connection**. Then run one sync and compare a few parcels' COD amounts with MDM. That is the check that proves MDM works.
