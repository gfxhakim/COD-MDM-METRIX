import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan, type WorkspaceContext } from "@/server/tenancy";
import { dayStart } from "@/lib/zonedDays";
import { bringsEverything, mdmProductIdOf, orderBrought, ruleFor, widens, type ProductChoices, type ProductRule } from "@/domain/mdmChoices";
import { ordersInApp } from "./orders";
import type { MdmOrder, MdmParcel } from "./types";

const PROVIDER = "MDM_EXPRESS" as const;

/** A first day as YYYY-MM-DD in the workspace's time zone. */
function dayIn(at: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export async function loadChoices(workspaceId: string): Promise<ProductChoices> {
  const [conn, rows] = await Promise.all([
    db.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: PROVIDER } }, select: { bringNewMdmProducts: true } }),
    db.mdmProductChoice.findMany({ where: { workspaceId }, select: { mdmProductId: true, bring: true, since: true } }),
  ]);
  return { bringNew: conn?.bringNewMdmProducts ?? true, rules: new Map(rows.map((r) => [r.mdmProductId, { bring: r.bring, since: r.since }])) };
}

/**
 * Splits a page of MDM orders into those the sync saves and those it skips. Every MDM product seen
 * for the first time is listed (brought in or not, as the workspace chose for new products), so it
 * can be picked on the MDM sync page. Orders already in the app are always kept, so they stay up to
 * date. Skipped orders are remembered, so their parcels are skipped too.
 */
export async function sortOrders(workspaceId: string, choices: ProductChoices, orders: MdmOrder[]): Promise<{ kept: MdmOrder[]; skipped: MdmOrder[] }> {
  const names = new Map<string, string | null>();
  for (const o of orders) for (const l of o.products) {
    const id = mdmProductIdOf(l);
    if (id && !choices.rules.has(id) && !names.has(id)) names.set(id, l.name?.slice(0, 200) ?? null);
  }
  for (const [id, name] of names) {
    const row = await db.mdmProductChoice.upsert({
      where: { workspaceId_mdmProductId: { workspaceId, mdmProductId: id } },
      create: { workspaceId, mdmProductId: id, name, bring: choices.bringNew },
      update: {},
      select: { bring: true, since: true },
    });
    choices.rules.set(id, row);
  }
  if (bringsEverything(choices)) return { kept: orders, skipped: [] };

  const out = orders.filter((o) => !orderBrought(choices, o.products.map(mdmProductIdOf), o.placedAt));
  const here = await ordersInApp(workspaceId, out);
  const skipped = out.filter((o) => !here.has(o.trackingId));
  const skip = new Set(skipped.map((o) => o.trackingId));
  const kept = orders.filter((o) => !skip.has(o.trackingId));
  for (const o of skipped) {
    await db.mdmSkippedOrder.upsert({ where: { workspaceId_mdmOrderId: { workspaceId, mdmOrderId: o.trackingId } }, create: { workspaceId, mdmOrderId: o.trackingId }, update: {} });
  }
  await forgetSkipped(workspaceId, kept.map((o) => o.trackingId));
  return { kept, skipped };
}

/** Orders brought in after all (a product turned back on) are no longer skipped, nor are their parcels. */
export async function forgetSkipped(workspaceId: string, mdmOrderIds: string[]) {
  if (mdmOrderIds.length) await db.mdmSkippedOrder.deleteMany({ where: { workspaceId, mdmOrderId: { in: mdmOrderIds } } });
}

/** The parcels on this page whose MDM order the sync skipped: they are skipped as well. */
export async function skippedParcels(workspaceId: string, parcels: MdmParcel[]): Promise<Set<string>> {
  const ids = [...new Set(parcels.map((p) => p.mdmOrderId).filter((id): id is string => !!id))];
  if (!ids.length) return new Set();
  const rows = await db.mdmSkippedOrder.findMany({ where: { workspaceId, mdmOrderId: { in: ids } }, select: { mdmOrderId: true } });
  return new Set(rows.map((r) => r.mdmOrderId));
}

/** MDM orders already in the app that the current choices would not bring in, by MDM product. */
async function ordersOutside(workspaceId: string, choices: ProductChoices, mdmProductId?: string) {
  if (bringsEverything(choices)) return [];
  const orders = await db.order.findMany({
    where: { workspaceId, source: "MDM_EXPRESS", lines: { some: mdmProductId ? { mdmProductId } : { mdmProductId: { not: null } } } },
    select: { id: true, mdmOrderId: true, placedAt: true, lines: { select: { mdmProductId: true } } },
  });
  return orders.filter((o) => !orderBrought(choices, o.lines.map((l) => l.mdmProductId), o.placedAt));
}

/** Every MDM product the app knows of (from orders, stock or a choice), with what the sync does with it. */
export async function listChoices(ctx: WorkspaceContext) {
  const ws = ctx.workspaceId;
  const choices = await loadChoices(ws);
  const [rows, links, stock, lines, outside, conn, workspace] = await Promise.all([
    db.mdmProductChoice.findMany({ where: { workspaceId: ws }, select: { mdmProductId: true, name: true } }),
    db.mdmProductLink.findMany({ where: { workspaceId: ws }, select: { mdmProductId: true, mdmName: true, product: { select: { name: true } } } }),
    db.mdmStockItem.findMany({ where: { workspaceId: ws }, distinct: ["mdmProductId"], select: { mdmProductId: true, productName: true } }),
    db.orderLine.groupBy({ by: ["mdmProductId"], where: { workspaceId: ws, mdmProductId: { not: null }, order: { source: "MDM_EXPRESS" } }, _count: { orderId: true }, _sum: { quantity: true } }),
    ordersOutside(ws, choices),
    db.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId: ws, provider: PROVIDER } }, select: { choicesWidenedAt: true, ordersSyncedAt: true } }),
    db.workspace.findUniqueOrThrow({ where: { id: ws }, select: { timezone: true } }),
  ]);
  const name = new Map<string, string | null>();
  for (const s of stock) name.set(s.mdmProductId, s.productName);
  for (const l of links) if (!name.get(l.mdmProductId)) name.set(l.mdmProductId, l.mdmName);
  for (const r of rows) if (!name.get(r.mdmProductId)) name.set(r.mdmProductId, r.name);
  const countsAs = new Map(links.map((l) => [l.mdmProductId, l.product.name]));
  const sold = new Map(lines.map((l) => [l.mdmProductId!, { orders: l._count.orderId, units: l._sum.quantity ?? 0 }]));
  const notBrought = new Map<string, number>();
  for (const o of outside) for (const id of new Set(o.lines.map((l) => l.mdmProductId))) if (id) notBrought.set(id, (notBrought.get(id) ?? 0) + 1);
  const products = [...name.keys()].map((id) => {
    const rule = ruleFor(choices, id);
    return {
      id,
      name: name.get(id) ?? null,
      bring: rule.bring,
      /** First day brought in (YYYY-MM-DD in the workspace's time zone), or null for every order. */
      sinceDay: rule.since ? dayIn(rule.since, workspace.timezone) : null,
      countsAs: countsAs.get(id) ?? null,
      orders: sold.get(id)?.orders ?? 0,
      units: sold.get(id)?.units ?? 0,
      /** Orders already in the app that this choice no longer brings in. */
      notBrought: notBrought.get(id) ?? 0,
    };
  });
  products.sort((a, b) => b.units - a.units || (a.name ?? a.id).localeCompare(b.name ?? b.id));
  return {
    bringNew: choices.bringNew,
    /** The next regular sync re-reads every MDM order once to bring in what was just turned on. */
    rereadPending: !!conn?.choicesWidenedAt && !!conn.ordersSyncedAt && conn.choicesWidenedAt > conn.ordersSyncedAt,
    products,
  };
}

export async function setChoice(ctx: WorkspaceContext, input: { mdmProductId: string; bring: boolean; sinceDay: string | null }) {
  assertCan(ctx, "integrations.manage");
  const ws = ctx.workspaceId;
  const { timezone } = await db.workspace.findUniqueOrThrow({ where: { id: ws }, select: { timezone: true } });
  const before = ruleFor(await loadChoices(ws), input.mdmProductId);
  const after: ProductRule = { bring: input.bring, since: input.bring && input.sinceDay ? dayStart(input.sinceDay, timezone) : null };
  await db.mdmProductChoice.upsert({
    where: { workspaceId_mdmProductId: { workspaceId: ws, mdmProductId: input.mdmProductId } },
    create: { workspaceId: ws, mdmProductId: input.mdmProductId, ...after },
    update: after,
  });
  // Orders skipped so far now come in: the next sync reads every MDM order once to fetch them.
  const widened = widens(before, after);
  if (widened) await db.integrationConnection.updateMany({ where: { workspaceId: ws, provider: PROVIDER }, data: { choicesWidenedAt: new Date() } });
  await audit(ctx, "mdm.product_choice_changed", { type: "MdmProductChoice", id: input.mdmProductId }, { bring: after.bring, since: after.since?.toISOString() ?? null });
  return { widened };
}

export async function setBringNew(ctx: WorkspaceContext, bringNew: boolean) {
  assertCan(ctx, "integrations.manage");
  await db.integrationConnection.upsert({
    where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider: PROVIDER } },
    create: { workspaceId: ctx.workspaceId, provider: PROVIDER, bringNewMdmProducts: bringNew },
    update: { bringNewMdmProducts: bringNew },
  });
  await audit(ctx, "mdm.new_products_choice_changed", { type: "IntegrationConnection", id: PROVIDER }, { bringNew });
  return { bringNew };
}

/**
 * Removes the MDM orders already in the app that the choices no longer bring in (for one MDM
 * product), with their parcels. They are remembered as skipped, so syncs leave them out; turning
 * the product back on brings them in again with the next sync.
 */
export async function removeNotBrought(ctx: WorkspaceContext, mdmProductId: string) {
  assertCan(ctx, "integrations.manage");
  const ws = ctx.workspaceId;
  const orders = await ordersOutside(ws, await loadChoices(ws), mdmProductId);
  if (!orders.length) return { orders: 0, parcels: 0 };
  const ids = orders.map((o) => o.id);
  const removed = await db.$transaction(async (tx) => {
    const parcels = await tx.parcel.deleteMany({ where: { workspaceId: ws, orderId: { in: ids } } });
    await tx.order.deleteMany({ where: { workspaceId: ws, id: { in: ids } } });
    for (const o of orders) {
      if (o.mdmOrderId) await tx.mdmSkippedOrder.upsert({ where: { workspaceId_mdmOrderId: { workspaceId: ws, mdmOrderId: o.mdmOrderId } }, create: { workspaceId: ws, mdmOrderId: o.mdmOrderId }, update: {} });
    }
    return { orders: ids.length, parcels: parcels.count };
  });
  await audit(ctx, "mdm.orders_removed", { type: "MdmProductChoice", id: mdmProductId }, removed);
  return removed;
}
