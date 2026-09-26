# Milestone 4 report: MDM Express connection and sync

## Blocker, first

**The live MDM adapter is not enabled yet.** The spec requires reading the raw MDM Express OpenAPI schema before implementing authentication, pagination, parcel search and field mapping, and says not to guess them. This build environment still can't reach `api.mdm.express`. Checked again on 2026-09-26 17:09 UTC: the proxy returned 403 for `api.mdm.express`, `mdm.express` and `www.mdm.express`. No OpenAPI file has been uploaded to the project either.

Everything else is built and tested against the labelled mock adapter. The schema-dependent parts are isolated in one place, `LIVE_SCHEMA` in `src/server/mdm/live.ts`, which has five functions to fill in:
- `applyAuth`
- `testRequest`
- `accountLabel`
- `parcelsRequest`
- `parseParcelsPage`

While it is `null`, the live adapter sends no request at all. A user's saved key stays encrypted and unused, and the connection test says plainly that live MDM isn't enabled yet (status "Saved, not verified"). It never claims a connection.

**To unblock:** upload MDM's OpenAPI JSON to the project (simplest), or have `api.mdm.express` allowed in the cloud environment's network access. Project settings has no network section. After that, the remaining work is:
1. Read the schema.
2. Fill in `LIVE_SCHEMA`, plus contract tests built from the schema's example responses.
3. Run the read-only connection test with a key you enter yourself in Settings.

## 1. Files changed

New
- `src/server/crypto/secrets.ts`: AES-256-GCM encryption for credentials, with key versions and rotation support. The workspace ID is bound in as associated data, and only a mask is ever shown.
- `src/server/mdm/types.ts`: the provider-neutral parcel/page types, the adapter interface and typed `MdmError`s (retryable or not).
- `src/server/mdm/url.ts`: the SSRF guard (https only, host allowlist, no IPs, credentials, ports or queries, and a DNS check that rejects private addresses).
- `src/server/mdm/live.ts`: the live adapter and a hardened GET client.
  - The client applies a timeout, disables redirects, caps body size, maps 401/403/429/5xx, honors `Retry-After`, and only ever puts the credential in a header.
  - Holds the `LIVE_SCHEMA` placeholder.
- `src/server/mdm/mock.ts`: the mocked adapter. It pages, filters by date, can script failures for tests, and rejects keys starting with `invalid`.
- `src/server/mdm/demo-fixtures.ts`: deterministic, labelled demo fixtures built from the demo workspace's seeded parcels.
- `src/server/mdm/redact.ts`: PII redaction for stored raw payloads and stable hashing.
- `src/server/mdm/connection.ts`: saving, removing and testing credentials, the sync interval, adapter selection, and the browser-safe view of the connection.
- `src/server/mdm/sync.ts`: the sync engine (enqueue with lock, worker, retries and backoff, resume, matching, upsert, status history, unmatched queue, status mapping).
- `src/server/mdm/runner.ts`: in-process background execution and a poller.
- `src/instrumentation.ts`: starts the poller when the server starts.
- `scripts/sync-worker.ts`: a standalone worker, run with `npm run sync:worker`.
- `src/server/trpc/routers/mdm.ts`: the `integrations.*` and `sync.*` endpoints.
- UI:
  - `src/app/(app)/syncs/sync-view.tsx` (replaces the placeholder page)
  - `src/app/(app)/settings/mdm-settings.tsx` (MDM Express tab and Status mappings tab)
- Tests: `tests/unit/mdm.test.ts` and `tests/integration/mdm-sync.test.ts`.

Changed
- `prisma/schema.prisma` and a new migration.
- `src/server/trpc/init.ts`: `SecretError` now maps to a 400 error.
- `src/server/trpc/root.ts`.
- `settings-view.tsx`: the old placeholders were removed.
- `data-freshness.tsx`: shows "connected, not synced yet".
- `vitest.config.mts`: sets `SYNC_BACKGROUND=off`.
- `.env.example`: documents key rotation, `MDM_ALLOWED_HOSTS`, `MDM_ADAPTER` and `SYNC_BACKGROUND`.
- `package.json`: adds `sync:worker`.

## 2. Database changes

Migration `20260926171500_mdm_sync`. It is additive; `SyncJob` is rebuilt by SQLite with its data copied over.
- `ConnectionStatus` has a new value, `UNTESTED`: the key is saved but no read-only test has passed yet.
- `IntegrationConnection` gains `credentialUpdatedAt` and `credentialUpdatedById`.
- `SyncJob` gains:
  - `mode` (FULL/INCREMENTAL), `adapter` (mock/live) and `updatedSince`
  - `attempt`, `nextRunAt` and `retryOfJobId`
  - `activeLock`, a unique column that is the per-workspace lock
  - a new index on `(status, nextRunAt)`
- `Parcel` gains `sourceOrderId`, the third matching key.

The tables `IntegrationConnection`, `SyncItem`, `RawExternalRecord`, `StatusMapping`, `UnmatchedRecord` and `ParcelStatusEvent` already existed from Milestone 1.

## 3. Features completed

**Per-workspace credentials** (Settings → MDM Express)
- An owner or admin pastes the key into a password field. It is sent once in a POST body and never in a URL.
- On the server it is:
  - validated
  - encrypted with AES-256-GCM, with the workspace ID bound as associated data (a ciphertext copied to another workspace won't decrypt)
  - stored with a key version, so keys can be rotated using `APP_ENCRYPTION_KEY_PREVIOUS`
- The browser only ever receives: status, `••••` plus the last 4 characters, last test time, last sync time, the last error, and whether the demo or live adapter is in use. The field is cleared after saving and there is no way to read the key back.
- Replace and Remove actions. Saving, removing, testing and interval changes are all audited, and no secret goes into the audit log.
- The base URL can only point at allowlisted https hosts (default `api.mdm.express`).
- There is no global key: `MDM_API_KEY` in `.env.example` is never read by the app.

**Read-only connection test**
- It runs on the server only and is rate-limited (10 per 10 minutes per workspace).
- The result is Connected, Error (with a safe, fixed message) or Saved-not-verified.
- Only a successful test enables syncing.
- The demo workspace uses the mock adapter. Its test result says plainly that it uses demo fixtures, not a real MDM account.

**Asynchronous sync** (MDM sync page)
- "Sync now" (incremental: changes since the last success, minus a 24-hour overlap) and "Full resync". Both return immediately, and the job runs on the server in the background.
- **Locking:** one queued or running job per workspace, enforced by a unique index. A concurrent request gets `alreadyRunning`.
- **Pagination with resume:** the cursor and page are saved after every page, along with a heartbeat. If the worker dies, the job resumes from its last page.
- **Backoff:** 429, 5xx and network errors are retried up to 4 times per page, with exponential backoff and jitter; a `Retry-After` header is honored. If a page still fails, the job goes back in the queue with a delay and resumes later, up to 3 attempts. An auth error fails the job immediately and marks the connection as Error.
- **Cancel** works for queued and running jobs.
- **Retry** re-runs a failed or partial sync over the same window.
- **Idempotent writes:**
  - Parcels are upserted by (workspace, provider, tracking ID), and only real changes count as "updated".
  - Status events are append-only and deduplicated by hash.
  - Raw payloads are stored once per distinct content hash, with PII (phones, names, addresses, emails, tokens) redacted.
  - Re-running the same data changes nothing.
- **Order sync:** when a parcel matched to a pending order has left the warehouse, the order becomes Confirmed.
- **Matching order:**
  1. order reference (normalized)
  2. an existing tracking-ID link
  3. store order ID
  4. otherwise, the unmatched review queue, with the reason
- Ambiguous references are never guessed, and manual links are never overwritten.
- **Unmatched review:** Link to an order (search by order number or tracking ID), Ignore, or Reopen. A parcel is resolved automatically once its order appears.
- **Unknown statuses:** the count is shown, and Settings → Status mappings maps each one once and immediately re-normalizes existing parcels and events.
- History shows each job's added, updated, unchanged, failed, unknown and unmatched counts, and its duration. The detail view lists each parcel's result. Active jobs update live.
- The poller (in-process, and optionally a separate worker process) picks up due retries and jobs orphaned by a restart.

## 4. Tests added and results

- `tests/unit/mdm.test.ts` (11 tests):
  - encryption round-trip, random IV, workspace binding, tamper detection, key rotation, masking
  - the SSRF allowlist and private-IP detection
  - payload redaction and stable hashing
  - the live adapter refuses to run and makes no fetch while the schema is unverified
  - the hardened client puts the credential only in a header, never in the URL; disables redirects; maps 429 with Retry-After, 401 and non-JSON; blocks a host that resolves to a private address
  - mock paging, date filtering and scripted failures
  - backoff bounds
- `tests/integration/mdm-sync.test.ts` (13 tests):
  - the key is never in the view, the database row or the audit log
  - the live test doesn't claim success, and sync is refused
  - the demo workspace's mock test and sync end to end
  - roles, and rejection of an SSRF base URL
  - matching by reference, then source ID, then the unmatched queue
  - PII-free raw payloads
  - idempotent re-sync
  - status updates; manual links preserved; unmatched parcels auto-resolved
  - status mapping re-normalizes parcels
  - 429/5xx retries honoring Retry-After
  - a job re-queued after repeated failures resumes from its cursor, and the lock is held meanwhile
  - an auth failure marks the connection
  - the single-active-job lock and cancel
  - tenant isolation
- **Full suite: 129 tests passing in 14 files.** ESLint and `tsc` are clean, and `next build` succeeds.
- Browser smoke test on the demo workspace (Playwright/Chromium, `next start`):
  - An invalid key showed an error. The demo key showed only `••••4242` and the field cleared after saving. The test passed.
  - The background sync succeeded with 3 added, 1 updated, 49 unchanged and 2 unmatched. The orphan parcel was linked manually. A second sync changed nothing.
  - The unknown status `held_at_hub` was mapped to Shipped.
  - Every response and request was scanned for the key: it never appeared. The browser never called an mdm.express URL. No console errors, no overflow at phone width, and the key was not in the server log.

## 5. Known limitations

- **Live MDM is not enabled** until the OpenAPI schema is read (see the blocker above). No user key has been used against MDM.
- Cash remittance and COD collection events are not synced yet. Where MDM exposes them depends on the schema. Delivered revenue works now; the "cash remitted" view still relies on data from outside MDM.
- Scheduled (interval) syncs are Milestone 5. The interval setting is saved, and the poller already handles retries and recovery.
- Jobs run inside the web server process, with an optional separate worker. For multi-instance deployments, run the worker; jobs are claimed atomically, so running both is safe.
- Syncs are incremental by `statusAt`. If the live API filters by a different "updated" field, the overlap window will be adjusted once the schema is known.

## 6. Exact next step

1. Upload the OpenAPI JSON (or allow `api.mdm.express` in the cloud environment's network access).
2. Read the raw schema for auth, pagination, parcel search and response fields.
3. Fill in `LIVE_SCHEMA` with contract tests.
4. HAKIM enters their own key in Settings and runs the read-only test.

Milestone 5 (scheduled sync, hardening, Playwright E2E, deployment and backup docs) can start in parallel.
