# Milestone 2 report: economics engine, dashboard, simulator, creative matrix

## 1. Files changed

New
- `src/domain/economics.ts`: the pure engine (parcel classification, per-order economics, totals, metrics, overhead allocation, verdicts)
- `src/domain/simulator.ts`: the breakeven CPA simulator (spec formula plus a detailed per-lead model and a sensitivity grid)
- `src/domain/matrixColumns.ts`, `src/lib/csv.ts` (formula-injection-safe export), `src/lib/definitions.ts` (metric tooltips)
- `src/server/reports/facts.ts`: loads the stored facts for one workspace, with a cost-version resolver
- `src/server/reports/economics.ts`: dashboard report, creative matrix, observed simulator inputs
- `src/server/trpc/routers/economics.ts`: `reports.dashboard`, `creatives.matrix`, `creatives.exportCsv`, `simulator.calculate`, `simulator.observed`, `simulator.listScenarios`, `simulator.saveScenario`, `simulator.deleteScenario`
- UI: `src/app/(app)/creatives/creatives-view.tsx`, `src/app/(app)/simulator/simulator-view.tsx`, `src/components/app/{sparkline,verdict,format}.tsx`
- Tests: `tests/unit/{economics,simulator,csv}.test.ts`, `tests/integration/reports.test.ts`

Changed
- `src/app/(app)/dashboard-view.tsx`: now shows the full profit dashboard
- products page: a simulator link on each product
- `src/domain/settings.ts`: target POAS now defaults to 0.3; added `minShippedForRates`
- `prisma/seed.ts`: realistic demo spend and overhead, demo verdict thresholds, gross REMITTED events
- `src/components/ui/tooltip.tsx`

## 2. Database changes

- Migration `order_call_attempts` adds a nullable `orders.callAttempts`, used when the call-center cost basis is "per call attempt". Existing rows are unaffected.
- Nothing else changed in the schema. Saved scenarios use the `simulator_scenarios` table created in Milestone 1.

## 3. Features completed

**Economics engine** (pure, with no database or React code)
- Counts: placed, confirmed, shipped, delivered, returned, lost, exchanged, in transit and unknown. Orders and parcels are counted separately.
- Rates: confirmation, shipping, delivery and return. A zero denominator gives `null`, which the UI shows as "—" or "Not enough data", never NaN or Infinity.
- COGS uses the cost version in effect on each order's date. With partial delivery, units are prorated across the non-canceled parcels.
- A carrier fee recorded on a parcel takes priority over the cost-version assumption.
- Costs: outbound shipping, RTO fee, packaging and call-center cost. The call-center basis can be per placed lead, per confirmed order or per call attempt.
- RTO loss = forward shipping + RTO fee + packaging burned on returned parcels.
- A parcel with an UNKNOWN status is never treated as delivered or returned. Once dispatched it counts as shipped and in transit, and the dashboard shows a warning for it.
- Delivered-revenue and cash-remitted views are labelled everywhere and can be switched per report.
- Overhead allocation by delivered orders, by delivered revenue, or none. Splits use the largest-remainder method, so allocated amounts add up exactly. Product-specific expenses stay with their product. Anything that can't be allocated is reported.
- Verdicts, in this order: KILL, then BAD_TRAFFIC, then SCALE, then INSUFFICIENT_DATA, then WATCH. All thresholds are set per workspace.

**Dashboard**
- KPI cards: net cash collected, cash in transit, delivered revenue, ad spend (with a sparkline), RTO loss, true net profit and blended POAS.
- A profit breakdown from revenue down to true net profit, a funnel with rates, per-wilaya contribution, the most profitable creatives, the creatives with the worst RTO, and data health.
- Filters: date range, product, creative and revenue basis.

**Breakeven simulator** (`/simulator` and per product)
- Default model is the spec formula, `(P − C − S) × D − R × Q − K`. There is a labelled option to assume Q = 1 − D.
- The detailed model takes separate confirmation, shipping, delivery, RTO and lost probabilities, and charges shipping and packaging on returned and lost parcels.
- Shows observed and scenario rates side by side, breakeven CPA, target CPA, and expected profit at your current CPA.
- Includes a delivery rate × CPA sensitivity grid, "Reset to observed", and saved scenarios you can load or delete.

**Creative matrix** (`/creatives`)
- Every column from the spec, aggregated on the server.
- Unattributed-orders and unmatched-spend rows appear alongside the creatives. All rows add up to the business totals.
- Sort, search, verdict filter, minimum sample size and column selection. Column choices are remembered per browser.
- CSV export with formula-injection protection. Every export is recorded in the audit log.

## 4. Tests

`npm test` → **76 passed, 0 failed** (10 files; Milestone 1 had 35)

- Unit tests (engine): zero denominators, UNKNOWN status handling, delivered and RTO orders, observed fees, multi-parcel partial delivery, canceled parcels, cost version by date, fallback fees, all 3 call-center bases, the spec profit formulas, revenue views, exact overhead splits, product-specific expenses, and every verdict branch.
- Unit tests (simulator): the spec formula, Q = 1 − D, target and expected profit, negative breakeven, grid monotonicity, the detailed model, and invalid probabilities.
- Unit tests (CSV): formula injection, numeric cells, quoting.
- Integration tests: dashboard numbers checked against a hand-computed workspace; product, creative and date filters; matrix buckets adding up to the totals; CSV sanitising a malicious campaign name; observed simulator inputs; saving scenarios; reports, the matrix, scenarios and exports all refusing cross-workspace access.

Also checked in a headless browser against a production build: the dashboard, the matrix, a CSV download, the simulator, saving a scenario and the mobile layout, all with no console errors.

## 5. Known limitations

- Reports load the facts for the selected range into server memory. That is fine at MVP volume. Beyond roughly 100k orders per range, precomputed `metric_snapshots` will be needed.
- The date range groups orders by placed date: an order and its parcels and cash count in the period the order was placed. Spend and expenses are filtered by their own dates.
- Returned goods are assumed to go back to stock, so they add no COGS. Lost parcels also add no COGS, following the spec formula. The carrier-reimbursement policy for lost parcels could be made configurable.
- Expenses in the CALL_CENTER category and the per-order call-center fee both count as cost. Don't enter the same cost both ways.
- KILL can fire while many parcels are still in transit, because profit only counts delivered revenue. Cash in transit is shown next to it, but the verdict doesn't forecast it yet.
- The demo workspace uses lower verdict thresholds (minimum sample of 5) so 60 orders show a mix of verdicts. New workspaces default to 20.

## 6. Exact next step

Milestone 3: CSV import wizards for orders, Meta spend, expenses and bank transactions. That covers upload, header detection, column mapping, a 25-row preview, row validation with errors, deduplication and an import summary. Then attribution normalization and spend-to-creative matching, the bank review queue, and import history with downloadable error CSVs.
