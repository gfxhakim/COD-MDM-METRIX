import type { Prisma } from "@prisma/client";
import { ACCOUNT_PART_LABEL, readPartStates, type AccountPart, type PartStates } from "@/domain/mdmAccount";
import { db } from "@/server/db";
import { safeMdmMessage } from "./connection";
import { MdmError, type MdmAccountReader, type MdmArrival, type MdmFeeLine, type MdmPayoutRecord, type MdmVariant } from "./types";

/**
 * After orders and parcels, each regular sync copies the seller's MDM account into the app:
 * wallet, money and fees per parcel, payouts, MDM's price list, stock, stock value and stock
 * arrivals. Only reads; nothing is ever deleted (variants MDM no longer lists are marked
 * archived). Each part is read on its own: a part the API key may not read, or one MDM fails
 * to answer, is noted on the Money & stock page and the other parts still sync.
 */

/** Incremental reads of fees and payouts start this long before the last full read. */
export const ACCOUNT_OVERLAP_MS = 24 * 3_600_000;
const MAX_PAGES = { fees: 500, payouts: 100, variants: 5, arrivals: 10 };
/** Payout breakdowns read per sync; the rest follow on later syncs. */
const MAX_BREAKDOWNS = 40;
/** Variants whose stock is read per sync. */
const MAX_STOCK_READS = 60;
/** MDM's price list rarely changes: read about once a day. */
const PRICES_EVERY_MS = 20 * 3_600_000;

export type AccountSyncOptions = {
  /** "FULL" re-reads every fee and payout; anything else reads what changed since the last sync. */
  mode: string;
  startedAt: Date;
  pageSize: number;
  now: () => Date;
  retry: <T>(fn: () => Promise<T>) => Promise<T>;
  canceled: () => Promise<boolean>;
  heartbeat: () => Promise<void>;
};

class Canceled extends Error {}
/** A part that can't be read for a reason worth showing as is. */
class PartNote extends Error {}

const cut = (v: string | null | undefined, n = 200) => (v ? v.slice(0, n) : null);
const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function syncMdmAccount(workspaceId: string, reader: MdmAccountReader, o: AccountSyncOptions): Promise<{ canceled: boolean; parts: PartStates }> {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { currency: true } });
  const acc = await db.mdmAccount.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} });
  const parts = readPartStates(acc.parts);
  const full = o.mode === "FULL";
  const since = (at: Date | null) => (full || !at ? null : new Date(at.getTime() - ACCOUNT_OVERLAP_MS));
  let sellerId = acc.sellerId;
  let currency = (acc.wallet as { currency?: string } | null)?.currency ?? ws.currency;
  let profileId: string | null | undefined;
  const profile = async () => {
    if (profileId === undefined) profileId = await o.retry(() => reader.profileId()).catch(() => null);
    return profileId;
  };

  /**
   * Fees and payouts carry the seller they belong to. A seller's key only sees its own; if MDM
   * ever sends several sellers', only the key's own account is kept, never someone else's.
   */
  const own = async <T extends { sellerId: string | null }>(items: T[]): Promise<T[]> => {
    const ids = [...new Set(items.map((i) => i.sellerId).filter((v): v is string => !!v))];
    if (!ids.length) return items;
    if (sellerId) return items.filter((i) => !i.sellerId || i.sellerId === sellerId);
    if (ids.length === 1) {
      sellerId = ids[0];
      return items;
    }
    const me = await profile();
    if (me && ids.includes(me)) {
      sellerId = me;
      return items.filter((i) => !i.sellerId || i.sellerId === me);
    }
    throw new PartNote("MDM sent lines for several sellers, so none were kept. Check which MDM account the API key belongs to.");
  };

  const run = async (name: AccountPart, fn: () => Promise<number | void>) => {
    if (await o.canceled()) throw new Canceled();
    const at = o.now().toISOString();
    const okAt = parts[name]?.okAt ?? null;
    try {
      const n = await fn();
      parts[name] = { at, okAt: at, ok: true, ...(typeof n === "number" ? { count: n } : {}) };
    } catch (e) {
      if (e instanceof Canceled) throw e;
      if (!(e instanceof MdmError) && !(e instanceof PartNote)) console.error(`[mdm] account ${name} failed`, e instanceof Error ? e.message : e);
      const denied = e instanceof MdmError && e.kind === "AUTH";
      const message = denied ? `Your MDM API key isn't allowed to read the ${ACCOUNT_PART_LABEL[name]}.` : e instanceof PartNote ? e.message : safeMdmMessage(e);
      parts[name] = { at, okAt, ok: false, ...(denied ? { denied: true } : {}), message };
    }
    await db.mdmAccount.update({ where: { workspaceId }, data: { parts: json(parts), sellerId } });
    await o.heartbeat();
  };

  /** Reads every page of a list, up to `max` pages. Returns false when pages were left unread. */
  const pages = async <T>(max: number, read: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>, save: (items: T[]) => Promise<void>) => {
    let cursor: string | null = null;
    for (let i = 0; i < max; i++) {
      if (await o.canceled()) throw new Canceled();
      const res = await o.retry(() => read(cursor));
      await save(res.items);
      await o.heartbeat();
      cursor = res.nextCursor;
      if (!cursor) return true;
    }
    return false;
  };

  try {
    await run("wallet", async () => {
      const w = await o.retry(() => reader.wallet());
      currency = w.currency;
      await db.mdmAccount.update({ where: { workspaceId }, data: { wallet: json(w), walletAt: o.now() } });
    });

    await run("fees", async () => {
      const from = since(acc.feesSyncedAt);
      let n = 0;
      const done = await pages(MAX_PAGES.fees, (cursor) => reader.fees({ cursor, updatedSince: from, pageSize: o.pageSize }), async (items) => {
        n += await saveFees(workspaceId, await own(items));
      });
      if (!done) throw new PartNote(`Read ${n} lines; MDM has more, which the next syncs will read.`);
      await db.mdmAccount.update({ where: { workspaceId }, data: { feesSyncedAt: o.startedAt } });
      return n;
    });

    await run("payouts", async () => {
      const from = since(acc.payoutsSyncedAt);
      let n = 0;
      const done = await pages(MAX_PAGES.payouts, (cursor) => reader.payouts({ cursor, updatedSince: from, pageSize: o.pageSize }), async (items) => {
        n += await savePayouts(workspaceId, await own(items));
      });
      // What each payout is made of: new or changed payouts first, a few per sync.
      const todo = await db.mdmPayout.findMany({ where: { workspaceId, breakdownAt: null }, orderBy: { mdmCreatedAt: "desc" }, take: MAX_BREAKDOWNS, select: { id: true, providerId: true } });
      for (const p of todo) {
        try {
          const b = await o.retry(() => reader.payoutBreakdown(p.providerId));
          await db.mdmPayout.update({ where: { id: p.id }, data: { breakdown: json(b), breakdownAt: o.now() } });
        } catch (e) {
          // The payouts themselves are saved; their breakdown is tried again next sync.
          if (e instanceof MdmError && (e.kind === "AUTH" || e.retryable)) break;
        }
      }
      if (!done) throw new PartNote(`Read ${n} payouts; MDM has more, which the next syncs will read.`);
      await db.mdmAccount.update({ where: { workspaceId }, data: { payoutsSyncedAt: o.startedAt } });
      return n;
    });

    await run("prices", async () => {
      const fresh = acc.pricesAt && o.now().getTime() - acc.pricesAt.getTime() < PRICES_EVERY_MS && parts.prices?.ok;
      if (!full && fresh) return parts.prices?.count;
      const id = sellerId ?? (await profile());
      if (!id) throw new PartNote("MDM didn't say which seller account this key belongs to, so its price list can't be read yet.");
      const prices = await o.retry(() => reader.prices(id));
      await db.mdmAccount.update({ where: { workspaceId }, data: { prices: json(prices), pricesAt: o.now() } });
      return prices.delivery.length;
    });

    await run("stock", async () => {
      const seen = new Set<string>();
      const done = await pages(MAX_PAGES.variants, (cursor) => reader.variants({ cursor, updatedSince: null, pageSize: o.pageSize }), async (items) => {
        for (const v of items) {
          seen.add(v.id);
          await saveVariant(workspaceId, v);
        }
      });
      // Variants MDM no longer lists stay, marked archived.
      if (done) await db.mdmStockItem.updateMany({ where: { workspaceId, archived: false, providerId: { notIn: [...seen] } }, data: { archived: true } });
      const active = await db.mdmStockItem.findMany({ where: { workspaceId, archived: false }, orderBy: { productName: "asc" }, take: MAX_STOCK_READS, select: { id: true, providerId: true, mdmProductId: true } });
      for (const v of active) {
        if (await o.canceled()) throw new Canceled();
        const c = await o.retry(() => reader.stock({ productId: v.mdmProductId, id: v.providerId }));
        await db.mdmStockItem.update({ where: { id: v.id }, data: { ...c, stockAt: o.now() } });
      }
      return active.length;
    });

    await run("capital", async () => {
      const c = await o.retry(() => reader.capital(currency));
      await db.mdmAccount.update({ where: { workspaceId }, data: { capital: json(c), capitalAt: o.now() } });
    });

    await run("arrivals", async () => {
      let n = 0;
      await pages(MAX_PAGES.arrivals, (cursor) => reader.arrivals({ cursor, updatedSince: null, pageSize: o.pageSize }), async (items) => {
        for (const a of items) await saveArrival(workspaceId, a);
        n += items.length;
      });
      return n;
    });
  } catch (e) {
    if (e instanceof Canceled) return { canceled: true, parts };
    throw e;
  }
  return { canceled: false, parts };
}

/** Saves a page of account lines, linked to the app's parcel and order when MDM names them. */
async function saveFees(workspaceId: string, lines: MdmFeeLine[]): Promise<number> {
  if (!lines.length) return 0;
  const keys = (pick: (l: MdmFeeLine) => (string | null)[]) => [...new Set(lines.flatMap(pick).filter((v): v is string => !!v))];
  const [parcels, orders] = await Promise.all([
    db.parcel.findMany({ where: { workspaceId, provider: "MDM_EXPRESS", trackingId: { in: keys((l) => [l.parcelTrackingId, l.entityId]) } }, select: { id: true, trackingId: true, orderId: true } }),
    db.order.findMany({ where: { workspaceId, mdmOrderId: { in: keys((l) => [l.orderTrackingId, l.entityId]) } }, select: { id: true, mdmOrderId: true } }),
  ]);
  const parcelBy = new Map(parcels.map((p) => [p.trackingId, p]));
  const orderBy = new Map(orders.map((o) => [o.mdmOrderId!, o.id]));
  let n = 0;
  for (const l of lines) {
    const parcel = (l.parcelTrackingId && parcelBy.get(l.parcelTrackingId)) || (l.entityId && parcelBy.get(l.entityId)) || null;
    const orderId = (l.orderTrackingId && orderBy.get(l.orderTrackingId)) || (l.entityId && orderBy.get(l.entityId)) || parcel?.orderId || null;
    const data = {
      entityId: cut(l.entityId),
      type: cut(l.type, 100)!,
      subType: cut(l.subType, 100),
      amount: l.amount,
      grossAmount: l.grossAmount,
      taxes: l.taxes,
      currency: l.currency,
      status: cut(l.status, 50)!,
      payoutId: cut(l.payoutId),
      parcelId: parcel?.id ?? null,
      orderId,
      mdmCreatedAt: l.createdAt,
      mdmUpdatedAt: l.updatedAt,
    };
    await db.mdmFee.upsert({ where: { workspaceId_providerId: { workspaceId, providerId: cut(l.id)! } }, create: { workspaceId, providerId: cut(l.id)!, ...data }, update: data });
    n++;
  }
  return n;
}

async function savePayouts(workspaceId: string, items: MdmPayoutRecord[]): Promise<number> {
  if (!items.length) return 0;
  const known = await db.mdmPayout.findMany({ where: { workspaceId, providerId: { in: items.map((p) => cut(p.id)!) } }, select: { providerId: true, mdmUpdatedAt: true } });
  const updatedAt = new Map(known.map((k) => [k.providerId, k.mdmUpdatedAt.getTime()]));
  for (const p of items) {
    const providerId = cut(p.id)!;
    const data = { amount: p.amount, currency: p.currency, status: cut(p.status, 50)!, confirmed: p.confirmed, storeNames: cut(p.storeNames.join(", "), 300), mdmCreatedAt: p.createdAt, mdmUpdatedAt: p.updatedAt };
    // A payout MDM changed has its breakdown read again.
    const changed = updatedAt.get(providerId) !== p.updatedAt.getTime();
    await db.mdmPayout.upsert({ where: { workspaceId_providerId: { workspaceId, providerId } }, create: { workspaceId, providerId, ...data }, update: { ...data, ...(changed ? { breakdownAt: null } : {}) } });
  }
  return items.length;
}

async function saveVariant(workspaceId: string, v: MdmVariant) {
  const data = { mdmProductId: cut(v.productId)!, productName: cut(v.productName)!, variantName: cut(v.variantName), sku: cut(v.sku, 100), sellingPrice: v.sellingPrice, purchasePrice: v.purchasePrice, currency: v.currency, archived: v.archived };
  await db.mdmStockItem.upsert({ where: { workspaceId_providerId: { workspaceId, providerId: cut(v.id)! } }, create: { workspaceId, providerId: cut(v.id)!, ...data }, update: data });
}

async function saveArrival(workspaceId: string, a: MdmArrival) {
  const data = { status: cut(a.status, 50)!, operation: cut(a.operation, 50), products: json(a.products.slice(0, 50).map((p) => ({ name: cut(p.name), sku: cut(p.sku, 100), expected: p.expected }))), expectedUnits: a.expectedUnits, receivedUnits: a.receivedUnits, damagedUnits: a.damagedUnits, mdmCreatedAt: a.createdAt, mdmUpdatedAt: a.updatedAt };
  await db.mdmStockArrival.upsert({ where: { workspaceId_providerId: { workspaceId, providerId: cut(a.id)! } }, create: { workspaceId, providerId: cut(a.id)!, ...data }, update: data });
}
