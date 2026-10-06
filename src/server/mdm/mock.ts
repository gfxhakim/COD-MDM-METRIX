import { hasOrderFilters, MdmError, type MdmAccountReader, type MdmAdapter, type MdmArrival, type MdmCapital, type MdmFeeLine, type MdmPayoutBreakdown, type MdmPayoutRecord, type MdmPriceList, type MdmStockCounts, type MdmVariant, type MdmWallet, type MdmDateRange, type MdmOrder, type MdmOrderFilters, type MdmOrderQuery, type MdmOrdersPage, type MdmPage, type MdmParcel, type MdmParcelQuery, type MdmUtm } from "./types";

/**
 * Mocked MDM adapter serving clearly labelled DEMO fixtures. It never makes a
 * network call. It exists so the whole sync pipeline can be exercised before
 * the live adapter is implemented from the verified OpenAPI schema.
 *
 * `failures` lets tests script provider errors per page (e.g. two 429s, then success).
 */
export type MockOptions = {
  fixtures: MdmParcel[];
  /** A credential beginning with "invalid" is rejected, to demo the error path. */
  credential: string | null;
  failures?: Record<number, MdmError[]>;
  latencyMs?: number;
  /** When set, the adapter also serves MDM orders (tests only; the demo workspace has none). */
  orders?: MdmOrder[];
  /** UTM tags found in an order's status history, by order tracking ID. */
  orderHistory?: Record<string, MdmUtm>;
  /** Errors thrown by order reads: per order page, and per history lookup. */
  orderFailures?: Record<number, MdmError[]>;
  historyFailures?: Record<string, MdmError[]>;
  /** How MDM treats search filters (tests only): applies them (default), ignores them, or rejects the request. */
  filters?: { orders?: FilterSupport; parcels?: FilterSupport };
  /** The seller's money and stock. Left out, the adapter has no account reader. */
  account?: MockAccount;
  /** Errors thrown by account reads, queued per read (e.g. `{ payouts: [AUTH error] }`). */
  accountFailures?: Partial<Record<keyof MdmAccountReader, MdmError[]>>;
};

export type MockAccount = {
  profileId: string | null;
  wallet: MdmWallet;
  payouts: MdmPayoutRecord[];
  breakdowns: Record<string, MdmPayoutBreakdown>;
  fees: MdmFeeLine[];
  prices: MdmPriceList;
  variants: MdmVariant[];
  stock: Record<string, MdmStockCounts>;
  capital: MdmCapital;
  arrivals: MdmArrival[];
};

type FilterSupport = "apply" | "ignore" | "reject";
type MockAdapter = MdmAdapter & { historyCalls: string[]; orderQueries: MdmOrderQuery[]; parcelQueries: MdmParcelQuery[]; accountCalls: string[] };

const within = (at: Date | null, r: MdmDateRange | undefined) => !r || (!!at && (!r.start || at >= r.start) && (!r.end || at <= r.end));

function mockOrderFilter(o: MdmOrder, f: MdmOrderFilters) {
  return (
    within(o.placedAt, f.createdAt) &&
    within(o.statusAt, f.statusDate) &&
    (f.isStopDesk === undefined || (o.deliveryType === "STOP_DESK") === f.isStopDesk) &&
    (!f.trackingIds?.length || f.trackingIds.includes(o.trackingId)) &&
    (!f.externalIds?.length || (!!o.externalId && f.externalIds.includes(o.externalId)))
  );
}

function pageOf<T>(all: T[], q: { cursor: string | null; pageSize: number }) {
  const page = q.cursor ? Number(q.cursor) : 0;
  return { items: all.slice(page * q.pageSize, (page + 1) * q.pageSize), nextCursor: (page + 1) * q.pageSize < all.length ? String(page + 1) : null, total: all.length };
}

function mockAccountReader(a: MockAccount, failures: Partial<Record<keyof MdmAccountReader, MdmError[]>>, calls: string[], checkAuth: () => void): MdmAccountReader {
  const queued = new Map(Object.entries(failures).map(([k, v]) => [k, [...(v ?? [])]]));
  const read = (name: keyof MdmAccountReader, detail = "") => {
    checkAuth();
    calls.push(detail ? `${name}:${detail}` : name);
    const q = queued.get(name);
    if (q?.length) throw q.shift()!;
  };
  const since = <T extends { updatedAt: Date }>(list: T[], at: Date | null) => [...list].filter((x) => !at || x.updatedAt >= at).sort((x, y) => x.updatedAt.getTime() - y.updatedAt.getTime());
  return {
    async profileId() { read("profileId"); return a.profileId; },
    async wallet() { read("wallet"); return a.wallet; },
    async payouts(q) { read("payouts", q.updatedSince?.toISOString() ?? "all"); return pageOf(since(a.payouts, q.updatedSince), q); },
    async payoutBreakdown(id) {
      read("payoutBreakdown", id);
      const b = a.breakdowns[id];
      if (!b) throw new MdmError("MDM returned 404", "BAD_RESPONSE");
      return b;
    },
    async fees(q) { read("fees", q.updatedSince?.toISOString() ?? "all"); return pageOf(since(a.fees, q.updatedSince), q); },
    async prices(sellerId) { read("prices", sellerId); return a.prices; },
    async variants(q) { read("variants"); return pageOf(a.variants, q); },
    async stock(v) { read("stock", v.id); return a.stock[v.id] ?? { totalInbound: 0, incoming: 0, available: 0, processing: 0, inDelivery: 0, delivered: 0, returning: 0, returned: 0, damaged: 0, discharged: 0, lost: 0 }; },
    async capital() { read("capital"); return a.capital; },
    async arrivals(q) { read("arrivals"); return pageOf([...a.arrivals].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime()), q); },
  };
}

export function createMockAdapter(opts: MockOptions): MockAdapter {
  const failures = new Map(Object.entries(opts.failures ?? {}).map(([k, v]) => [Number(k), [...v]]));
  const orderFailures = new Map(Object.entries(opts.orderFailures ?? {}).map(([k, v]) => [Number(k), [...v]]));
  const historyFailures = new Map(Object.entries(opts.historyFailures ?? {}).map(([k, v]) => [k, [...v]]));
  const historyCalls: string[] = [];
  const orderQueries: MdmOrderQuery[] = [];
  const parcelQueries: MdmParcelQuery[] = [];
  const accountCalls: string[] = [];
  const support = { orders: opts.filters?.orders ?? "apply", parcels: opts.filters?.parcels ?? "apply" };
  const wait = (signal?: AbortSignal) => (opts.latencyMs ? new Promise<void>((r, j) => { const t = setTimeout(r, opts.latencyMs); signal?.addEventListener("abort", () => { clearTimeout(t); j(new MdmError("Aborted", "NETWORK")); }); }) : Promise.resolve());
  const checkAuth = () => {
    if (!opts.credential) throw new MdmError("No credential saved for this workspace", "CONFIG");
    if (opts.credential.startsWith("invalid")) throw new MdmError("MDM rejected the credential (demo)", "AUTH");
  };
  return {
    kind: "mock",
    async testConnection(signal) {
      await wait(signal);
      checkAuth();
      return { accountLabel: "Demo fixtures (not a real MDM account)" };
    },
    async listParcels(q, signal): Promise<MdmPage> {
      const { cursor, updatedSince, pageSize, mdmOrderIds } = q;
      await wait(signal);
      checkAuth();
      parcelQueries.push(q);
      const page = cursor ? Number(cursor) : 0;
      const queued = failures.get(page);
      if (queued?.length) throw queued.shift()!;
      const ids = mdmOrderIds?.length ? mdmOrderIds : null;
      if (ids && support.parcels === "reject") throw new MdmError("MDM returned 400", "BAD_RESPONSE");
      const all = opts.fixtures.filter((p) => (!updatedSince || !p.statusAt || p.statusAt >= updatedSince) && (!ids || support.parcels === "ignore" || (!!p.mdmOrderId && ids.includes(p.mdmOrderId))));
      const items = all.slice(page * pageSize, (page + 1) * pageSize);
      const more = (page + 1) * pageSize < all.length;
      return { items, nextCursor: more ? String(page + 1) : null, total: all.length };
    },
    ...(opts.orders
      ? {
          async listOrders(q: MdmOrderQuery): Promise<MdmOrdersPage> {
            const { cursor, pageSize, filters } = q;
            checkAuth();
            orderQueries.push(q);
            const page = cursor ? Number(cursor) : 0;
            const queued = orderFailures.get(page);
            if (queued?.length) throw queued.shift()!;
            const filtered = hasOrderFilters(filters);
            if (filtered && support.orders === "reject") throw new MdmError("MDM returned 400", "BAD_RESPONSE");
            // Mock orders carry no update time, so `updatedSince` reads them all.
            const all = filtered && support.orders === "apply" ? opts.orders!.filter((o) => mockOrderFilter(o, filters!)) : opts.orders!;
            const items = all.slice(page * pageSize, (page + 1) * pageSize);
            return { items, nextCursor: (page + 1) * pageSize < all.length ? String(page + 1) : null, total: all.length };
          },
          async orderUtm(trackingId: string): Promise<MdmUtm | null> {
            checkAuth();
            historyCalls.push(trackingId);
            const queued = historyFailures.get(trackingId);
            if (queued?.length) throw queued.shift()!;
            return opts.orderHistory?.[trackingId] ?? null;
          },
        }
      : {}),
    ...(opts.account ? { account: mockAccountReader(opts.account, opts.accountFailures ?? {}, accountCalls, checkAuth) } : {}),
    historyCalls,
    orderQueries,
    parcelQueries,
    accountCalls,
  } as MockAdapter;
}
