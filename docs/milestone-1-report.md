# Milestone 1 report: foundation

Location: `/mnt/project-files/cod-flow-tracker` (no GitHub repo attached yet; local git history included).

## 1. Files changed (96 tracked files)

- `prisma/schema.prisma`, `prisma/migrations/*_init`, `prisma/seed.ts`
- `src/server/`: `db.ts`, `tenancy.ts`, `audit.ts`, `rateLimit.ts`, `auth/{password,session}.ts`,
  `repositories/{workspaces,products,orders,expenses,overview}.ts`, `trpc/{init,root,schemas}.ts`, `trpc/routers/*`
- `src/domain/`: `costVersions.ts`, `statusMapping.ts`, `settings.ts`
- `src/lib/`: `money.ts`, `normalize.ts`, `pii.ts`, `permissions.ts`, `labels.ts`, `utils.ts`, `trpc/client.tsx`
- `src/app/(auth)/*` (sign in, sign up, server actions), `src/app/(app)/*` (dashboard, products, orders, expenses, settings, placeholders for simulator/creatives/imports/syncs), `src/app/api/trpc/[trpc]/route.ts`
- `src/components/ui/*` (button, form, card, badge, dialog/drawer, tabs, tooltip, table, states, toast), `src/components/app/*` (shell, nav, data freshness, status badges, money input)
- `tests/unit/*`, `tests/integration/*`, `vitest.config.mts`, `next.config.ts` (security headers), `README.md`

## 2. Database changes

One migration (`init`) creating 30 tables:
identity/tenancy (users, sessions, workspaces, workspace_members, audit_logs, rate_limit_buckets);
MDM (integration_connections, sync_jobs, sync_items, raw_external_records, status_mappings, unmatched_records);
commerce (products, product_cost_versions, orders, order_lines, attributions, parcels, parcel_status_events, cash_events);
marketing/finance (creatives, ad_spend, expenses, bank_transactions, import_batches, import_row_errors, metric_snapshots, simulator_scenarios).

UUID primary keys, money as integer minor units + currency (default DZD), all required uniques
(workspace+source+external order ID, workspace+provider+tracking ID, workspace+platform+creative ID,
workspace+source+row hash) and indexes (dates, workspace+normalized status, workspace+wilaya,
workspace+creative+order date). Status events are append-only (unique parcel+event hash).
New workspaces get default MDM status mappings, economics defaults and verdict thresholds.

## 3. Features completed

- Email/password auth (scrypt, hashed session tokens, httpOnly cookies, rate-limited login/signup)
- Workspaces, switcher, create-new, members with OWNER/ADMIN/ANALYST/OPERATOR, last-owner protection
- Server-side membership check on every procedure; repository methods require a WorkspaceContext
- Audit log (member/role changes, product and cost-version changes, order/expense deletion, manual parcel link/unlink) with secret redaction
- Dark operations shell: sidebar, mobile drawer, DEMO DATA banner, always-visible MDM freshness + "needs review" count, keyboard focus states, reduced-motion support, metric definition tooltips
- Dashboard (M1 scope): order → parcel funnel with safe rates ("Not enough data" on zero denominators), data-health panel, wilaya breakdown, date filter
- Products CRUD with immutable, effective-dated cost versions and history drawer
- Orders list (filters, search, pagination), detail drawer (lines, attribution, parcels, status timeline, provider reference, match confidence), manual orders, status changes, delete, manual parcel link/unlink
- Expenses CRUD with categories, global vs product allocation, fixed/variable, monthly totals, unallocated total
- Settings: workspace, members & roles, economics defaults + verdict thresholds, MDM status (read-only), default status mappings, audit log
- Demo seed: 3 products, 8 creatives, 60 orders, 50 parcels (delivered, returned, shipped, canceled, lost, exchanged, 2 unknown statuses, 1 split shipment), 1 unmatched MDM parcel, 1 failed import row, ad spend incl. unmatched spend, global + product expenses, 2 pending bank rows. Second demo workspace for isolation checks.
- Security headers (CSP, frame-deny, nosniff, HSTS in prod) and cross-origin POST rejection

## 4. Tests

`npm test` → **35 passed, 0 failed** (6 files).

- Unit: money parsing/rounding/overflow, reference + creative-key normalization, status normalization incl. unknown statuses, phone hashing/masking, cost-version effective dates, role permission matrix, audit redaction
- Integration: tenant isolation (lists, spoofed workspace id → FORBIDDEN, guessed ids → NOT_FOUND on read/update/delete, cross-tenant parcel/product linking, members, audit log, unauthenticated), roles (analyst read-only, operator limits, admin can't change roles, last-owner guard), cost history never overwritten, product delete → deactivate, duplicate SKU → CONFLICT, manual order attribution + PII hashing + deletion audit

Also verified manually in a headless browser against a production build: sign-in, every page renders with no console errors, product and expense creation, order drawer, 390px mobile layout; cross-origin POST returns 403.

## 5. Known limitations

- Profit metrics, simulator, creative matrix are Milestone 2 (clearly labelled placeholders in the UI).
- CSV imports and bank review are Milestone 3. MDM credential form, connection test and sync are Milestone 4.
- api.mdm.express is blocked from this build environment's network, so the OpenAPI schema could not be read yet. The live adapter will not be written until it can be.
- Members can only be added if they already have an account (no email invitations).
- Prisma schema uses the SQLite provider; production PostgreSQL migration steps are part of Milestone 5 docs.
- No password reset flow yet.

## 6. Exact next step

Milestone 2: build the pure economics engine in `src/domain/economics.ts` (counts, rates, COGS by
effective cost version, shipping/RTO/call-center/packaging, overhead allocation, net cash vs delivered
revenue, true profit, POAS, CPCO/CPDO/placed CPA, verdict precedence) with unit tests, then wire it
into `reports.dashboard`, `creatives.matrix` and `simulator.calculate`.
