# Milestone 4 report: MDM Express connection and sync

## Status, first

**The live MDM adapter is implemented from MDM's OpenAPI document, but not yet verified against a real account.** HAKIM uploaded the OpenAPI JSON on 2026-09-26. The adapter was written from its raw schemas, with no guessing from endpoint names. No real key has been used, because this build environment cannot reach `api.mdm.express` and no key belongs here. **MDM is not confirmed working** until the read-only connection test passes with the workspace owner's own key, entered in Settings in a running deployment that can reach MDM.

What the schema says, and how the adapter uses it (`LIVE_SCHEMA` in `src/server/mdm/live.ts`):

| Concern | From the schema | Adapter |
|---|---|---|
| Auth | `ApiKey` scheme: API key in header `x-api-key` (a `bearer` JWT is also accepted) | Sends only `x-api-key`, decrypted server-side per workspace |
| Read-only test | `GET /api/auth/me` returns GetMyProfileResponse | Shows only the account `trackingId` and role; names, email and phones are dropped |
| Status list | `GET /api/v2/shipping/parcels/metadata` returns `statuses[]` | Read during the test to list statuses that aren't mapped yet (best effort) |
| Parcel search | `POST /api/v2/shipping/parcels/search` with `filters`, `sortBy`, `pagination {page, perPage}` | `filters.updatedAt.start` for incremental syncs, `sortBy.updatedAt ASC`, up to 100 per page |
| Pagination | `pagination {page, total, hasMore, nextPage}`, `list: Parcel[]` | Cursor = page number; next from `nextPage` (or `hasMore`) |
| Merchant reference | Parcel only has `orderId` (MDM's order ID). `Order.externalId` is the merchant's order ID | One batched `POST /api/v2/orders/search` by `filters.trackingId` per page; `externalId` becomes the match reference |
| Fields | `status`, `statusDate`, `statusHistory[] {date, status}`, `pricing.totalToPayFromClient`, `fees.shipping`, `fees.return`, `destinationAddress.stateName`, `currency` | Mapped to COD amount, fees, wilaya, events, and dispatched/delivered/returned dates |

**Read-only by construction:** the client only sends GET, or POST to a path ending in `/search`. Anything else is refused before a request is made.

**Assumptions to confirm on the first real test** (the schema doesn't state them):
1. **Money units.** Amounts are plain numbers; the adapter treats them as major units (4000 means 4 000 DZD). If the first synced parcel shows a COD amount 100 times too large or small, this is the line to change.
2. **Status strings.** The API uses camelCase (e.g. `outForDelivery`). Clear ones are mapped by default: delivered, returned, lost, outForDelivery, readyForDelivery, waitingCollection, settled. Ambiguous ones (postponed, deliveryFailed, deliveryAttemptFailed, deliveredPartially, incoming) go to the review queue on purpose. The connection test lists every unmapped status MDM reports.
3. **Order access.** If the key can read parcels but not orders, sync still runs; parcels then match by tracking ID or land in the unmatched queue.

## 1. Files changed

New
- `src/server/crypto/secrets.ts`: AES-256-GCM encryption for credentials, with key versions and rotation support. The workspace ID is bound in as associated data, and only a mask is ever shown.
- `src/server/mdm/types.ts`: the provider-neutral parcel/page types, the adapter interface and typed `MdmError`s (retryable or not).
- `src/server/mdm/url.ts`: the SSRF guard (https only, host allowlist, no IPs, credentials, ports or queries, and a DNS check that rejects private addresses).
- `src/server/mdm/live.ts`: the live adapter and a hardened read-only client (GET, or POST to `/search` only).
  - The client applies a timeout, disables redirects, caps body size, maps 401/403/429/5xx, honors `Retry-After`, and only ever puts the credential in a header.
  - Holds `LIVE_SCHEMA`, the MDM contract read from the OpenAPI document, and the parcel mapping.
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

- `tests/unit/mdm-live.test.ts` (13 tests, new with the live adapter). Payloads are built field by field from the schema, which has no examples; placeholder values only:
  - `x-api-key` is the only auth header and the key never appears in a URL
  - the profile test shows only the account ID and role, and reads the status list; a 403 on the status list still connects; a 401 is an auth error
  - the exact parcel search body (updatedAt filter, sort, page, perPage), page cursors, total, and the page-size cap
  - one batched order lookup per page, `externalId` as the reference; no order access still syncs; a 429 on the lookup retries the page
  - a response that isn't GetParcelsResponse is rejected; a non-search POST is refused before any request
  - field mapping, including nullable fields, event ordering and derived dates
  - client, courier, seller, address, GPS and notes are redacted from stored payloads
  - camelCase status normalization, with ambiguous statuses left for review
- `tests/unit/mdm.test.ts` (11 tests):
  - encryption round-trip, random IV, workspace binding, tamper detection, key rotation, masking
  - the SSRF allowlist and private-IP detection
  - payload redaction and stable hashing
  - the live adapter makes no fetch when no schema is configured
  - the hardened client puts the credential only in a header, never in the URL; disables redirects; maps 429 with Retry-After, 401 and non-JSON; blocks a host that resolves to a private address
  - mock paging, date filtering and scripted failures
  - backoff bounds
- `tests/integration/mdm-sync.test.ts` (13 tests):
  - the key is never in the view, the database row or the audit log
  - live test through the real encrypted-key path: a rejected key is ERROR and sync stays locked; an accepted key is CONNECTED, lists unmapped statuses, and the key goes only to api.mdm.express in the `x-api-key` header
  - live sync end to end with stubbed MDM responses: a parcel matched to its order through `externalId`, COD converted to minor units, and no PII stored
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
- **Full suite: 143 tests passing in 15 files.** ESLint and `tsc` are clean, and `next build` succeeds.
- Browser smoke test on the demo workspace (Playwright/Chromium, `next start`):
  - An invalid key showed an error. The demo key showed only `••••4242` and the field cleared after saving. The test passed.
  - The background sync succeeded with 3 added, 1 updated, 49 unchanged and 2 unmatched. The orphan parcel was linked manually. A second sync changed nothing.
  - The unknown status `held_at_hub` was mapped to Shipped.
  - Every response and request was scanned for the key: it never appeared. The browser never called an mdm.express URL. No console errors, no overflow at phone width, and the key was not in the server log.

## 5. Known limitations

- **Live MDM is implemented but unverified.** No real key has been used against MDM; money units and status strings are assumptions until the first real test (see Status, first).
- Cash remittance and COD collection events are not synced yet. Where MDM exposes them depends on the schema. Delivered revenue works now; the "cash remitted" view still relies on data from outside MDM.
- Scheduled (interval) syncs are Milestone 5. The interval setting is saved, and the poller already handles retries and recovery.
- Jobs run inside the web server process, with an optional separate worker. For multi-instance deployments, run the worker; jobs are claimed atomically, so running both is safe.
- Live syncs are incremental by MDM's `updatedAt`, with a 24-hour overlap. The mock adapter filters by `statusAt`.
- MDM's parcel search `perPage` limit isn't stated in the schema; the adapter asks for at most 100.

## 6. Exact next step

1. HAKIM runs the app somewhere that can reach `api.mdm.express`, enters their own MDM key in Settings, and clicks Test connection. Nothing is written to MDM.
2. If it connects, map any statuses the test lists, run one sync, and check a few parcels' COD amounts against MDM to confirm the money units.
3. Report back any mismatch; fixes are confined to `src/server/mdm/live.ts`.

Milestone 5 (scheduled sync, hardening, Playwright E2E, deployment and backup docs) can start in parallel.
