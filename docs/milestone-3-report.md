# Milestone 3 report: CSV imports

## 1. Files changed

New
- `src/domain/imports/csv.ts`: CSV parsing. Detects the delimiter (`,` `;` tab `|`), strips the BOM, rejects binary files, files over 5 MB and more than 50,000 rows, renames duplicate headers, and keeps each row's real spreadsheet line number (so multi-line quoted cells don't shift it).
- `src/domain/imports/dates.ts`: detects day-first vs month-first and parses dates, including ISO with a timezone offset. Impossible dates such as 31/09 are rejected.
- `src/domain/imports/fields.ts`: the fields each import accepts, with English and French header synonyms, plus automatic column mapping.
- `src/domain/imports/common.ts`: shared cell, money and integer helpers, and occurrence keys.
- `src/domain/imports/orders.ts`: the Shopify/EasySell order validator. Handles multi-line grouping, EN/FR statuses and UTM parameters read from the landing URL.
- `src/domain/imports/spend.ts`: the Meta spend validator. Handles currency conversion, zero rows and the dedupe identity.
- `src/domain/imports/finance.ts`: the expense and bank validators.
- `src/server/imports/service.ts`:
  - preview and commit
  - duplicate detection and chunked writes
  - attribution relinking
  - history, error CSV, batch deletion and "reuse last mapping"
- `src/server/imports/review.ts`: the bank review queue (categorize, exclude, reopen), unmatched-spend resolution, and assigning a creative's product.
- `src/server/errors.ts`: `InputError`, which is shown to the user as a 400 error.
- `src/server/trpc/routers/imports.ts`: the `imports.*`, `bank.*` and `spendReview.*` endpoints.
- UI in `src/app/(app)/imports/`: `imports-view`, `import-wizard`, `import-history`, `bank-review`, `unmatched-spend`, `download`.
- Tests: `tests/unit/imports.test.ts` and `tests/integration/imports.test.ts`.

Changed
- `prisma/schema.prisma` and a new migration (see section 2).
- `src/server/trpc/init.ts`: `InputError` now maps to BAD_REQUEST.
- `src/server/trpc/root.ts`: registers the new routers.
- `src/server/trpc/routers/economics.ts`: adds `creatives.list`.
- `src/lib/pii.ts`: adds `hashCustomerRef`.
- Expenses page: links to the bank review queue. Orders page: empty-state copy.
- `package.json`: adds `papaparse`.

## 2. Database changes

Migration `20260926165000_import_pipeline` is additive only, so existing rows are unaffected.
- `ad_spend`:
  - `originalSpend`, `originalCurrency` and `fxRate` keep the amount exactly as exported when it was converted to the workspace currency.
- `expenses`:
  - New `sourceRowHash` column.
  - Unique on `(workspaceId, sourceRowHash)`, so re-imported expense files don't duplicate. Manual expenses keep `NULL`.
- `import_batches`:
  - `source` (SHOPIFY / EASYSELL / OTHER / META_CSV).
  - `updatedRows`.
  - `options` (date format, FX rate, creative options).
  - `summary` (warnings, created creatives, relinked orders, failure note).

## 3. Features completed

**Import wizard** (Imports page, tabs Orders / Ad spend / Expenses / Bank)
1. Upload by drag-and-drop or file picker. The browser checks the extension (.csv/.tsv/.txt), the 5 MB size limit and for empty files, and the server re-checks all of them.
2. Header detection and column mapping, with suggestions from EN/FR synonyms. Each dropdown shows a sample value. The last successful mapping is reused when the headers match.
   - Options:
     - date format (auto, D/M/Y, M/D/Y, ISO)
     - order source
     - for spend: FX rate, creating new creatives, and the product for new creatives
3. Preview and validation, with nothing written yet:
   - counts for new, duplicate, to-update, error and warning rows
   - the first 25 valid records
   - every row error with its line, field, problem and row values
   - warnings, and creative IDs that are new to the workspace
4. Import writes only the valid rows. The summary offers the error CSV and "Import another file".
- Downloadable CSV templates for each import type.

**Orders (Shopify / EasySell)**
- Multi-line orders are grouped by order number. Shopify fills the ID on the first line only, which is handled.
- If any line of an order is invalid, the whole order is rejected rather than imported half-complete.
- Products are matched by SKU, then by name. An unknown product is imported with a warning and zero COGS.
- COD is the order total, or Σ quantity × price when there is no total. Orders in a currency other than the workspace's are rejected.
- Status is read in EN/FR (confirmé / annulé / en attente / livré…). Unrecognized statuses import as pending, with a warning.
- Phones are stored only as a salted hash and a mask, and customer IDs only as a salted hash. Error rows keep only mapped columns, with phones masked.
- UTM values come from the UTM columns. When those are empty, they are read from the landing URL.
- Dedupe key: workspace + source + external order ID. The same number from another source counts as a different order.

**Meta ad spend**
- Currency comes from the currency column or from the header, e.g. "Amount spent (USD)". Foreign-currency spend needs an exchange rate, and the original amount, currency and rate are stored.
- Rows with zero spend and zero impressions are skipped.
- Dedupe identity is date + campaign + ad set + ad + creative (+ occurrence), **excluding the amount**. Re-exporting the same days therefore updates the amounts ("Updated") instead of double counting.
- Creative matching uses the normalized creative / ad ID / ad name. New IDs can be created as creatives (the default), or kept as **unmatched spend**. Rows with no ID at all are always kept as unmatched spend.

**Attribution normalization**
- After every order or spend import, orders whose `utm_content` arrived before the creative existed are linked to it by normalized key. Spend rows whose creative now exists are linked the same way.
- Manual attributions are never changed.

**Unmatched-spend review** (Ad spend tab)
- Unmatched spend is grouped by creative ID, showing dates, rows and spend.
- "Match" either creates a creative (with a name and optional product) or links the ID to an existing creative. Matching orders are then relinked and the action is audited.

**Expenses**
- Category synonyms (EN/FR). An unknown category becomes Other, with a warning.
- A product SKU makes the expense product-specific; an unknown SKU is an error. Fixed and variable costs are both supported.
- Content-hash dedupe. Two identical rows in one file are both kept, but re-importing the file adds nothing.

**Bank statements and review queue**
- Amounts can be signed, or given as debit/credit columns. Rows enter the queue as PENDING and **do not affect profit**.
- Categorize (money out only) creates a linked expense, with a category guessed from the label.
- Exclude works on one row or in bulk. Undo/Reopen removes the linked expense.
- The pending count shows on the Bank tab, and the Expenses page links to the queue.

**History and error review**
- Each batch shows status (Imported / Partial / Failed) and row, imported, updated, duplicate and error counts.
- The detail dialog shows stored row errors (up to 2,000 per batch), warnings, created creatives and relinked orders.
- The error CSV has line, field, error and the original mapped values. It is protected against formula injection (`=HYPERLINK…` is exported as text).
- Correction: "Delete import" removes everything a batch created: orders with their lines and attribution, spend, expenses, bank rows and expenses made from them. Parcels matched to deleted orders become unmatched. The deletion is audited. Fix the file, then import it again.

**Security**
- Importing needs `imports.write` (owner/admin); bank review needs `expenses.write`; spend matching needs `catalog.write`.
- Every query is scoped to the workspace, so another tenant's batch returns NOT_FOUND.
- Rate limits: 60 previews a minute per user, and 30 commits per 10 minutes per workspace.
- `import.committed`, `import.deleted`, `bank.*` and `spend.matched` are written to the audit log.

## 4. Tests added and results

- `tests/unit/imports.test.ts` (17 tests):
  - CSV parsing (BOM, delimiter, line numbers, duplicate headers, binary/empty files)
  - date detection and parsing
  - Shopify and Meta header mapping
  - order grouping and UTM from URL, COD defaults, whole-order rejection, currency mismatch, EN/FR statuses
  - FX conversion, zero-row skipping, identity that ignores the amount
  - expense categories and SKUs, bank debit/credit
- `tests/integration/imports.test.ts` (12 tests), run through the real tRPC caller and database:
  - preview writes nothing
  - multi-line import and phone hashing; duplicates on re-import; source-scoped dedupe
  - error rows without raw phones, and the sanitized error CSV
  - creative creation with FX and relinking of earlier orders
  - re-export updates amounts and doesn't double count
  - unmatched spend is kept, then resolved; resolving is tenant-isolated
  - FX rate required; expense dedupe
  - bank categorize, exclude and reopen; batch deletion with cascade and audit
  - tenant isolation of list, get, error CSV and delete; role enforcement
  - input validation (non-CSV name, unknown column, missing required field)
- **Full suite: 105 tests passing in 12 files.** ESLint and `tsc --noEmit` are clean, and `next build` succeeds.
- Browser smoke test (Playwright/Chromium against `next start` on the demo workspace):
  - Imported a Shopify CSV (day-first dates, one impossible date) and got 2 orders, 1 row error and the error CSV download. Re-importing showed "Nothing new to import".
  - Imported a USD Meta CSV at 250 DZD/USD, kept unknown creatives unmatched, then matched one, which linked one earlier order.
  - Imported a semicolon, debit/credit bank CSV; categorized OpenAI (auto-guessed "AI tools") and excluded the incoming MDM transfer.
  - The history detail dialog worked. At phone width there was no horizontal overflow and no console errors.

## 5. Known limitations

- Imports run synchronously in the request, in chunks of 200 orders. That is fine up to the 5 MB / 50k-row cap. Background jobs arrive with the Milestone 4 sync worker.
- The CSV is sent twice (once for preview, once for commit) and is not stored on the server. This is deliberate, so no raw customer file is kept; the error CSV holds only the failing rows' mapped columns.
- Re-importing an order that already exists skips it; changes are not merged. Status changes should come from MDM (Milestone 4) or be edited on the order. Re-importing spend does update amounts.
- Deleting a batch doesn't undo spend amounts that a later batch updated on the same rows. It deletes the rows the batch originally created.
- Only Meta is supported as an ad platform in the spend importer (the schema already allows TikTok and others).
- An FX rate is one rate per file. For multi-month USD exports at different rates, import one file per month.
- Excel (.xlsx) files must be saved as CSV first.

## 6. Exact next step

Milestone 4, the MDM Express integration:
- a per-workspace credential form in Settings, stored with AES-256-GCM, with a masked display and a read-only connection test
- a server-side adapter behind an SSRF allowlist
- async sync jobs with locking and backoff; raw payloads and status history
- parcel matching by order reference → tracking ID → source ID → the unmatched review queue

**Blocker:** this cloud environment's network policy blocks `api.mdm.express`, so the OpenAPI schema can't be read yet, and the spec says not to guess it. Before Milestone 4 can build the live adapter, that host must be allowed in the environment's network settings, or the OpenAPI JSON must be uploaded to the project. The mocked adapter, credential storage and job pipeline can be built without it.
