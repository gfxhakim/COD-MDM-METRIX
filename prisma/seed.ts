/**
 * Seeds two clearly labelled DEMO workspaces with synthetic data.
 * Nothing here is real customer, carrier or MDM data. Parcels are flagged isDemoFixture.
 *
 *   demo@codflow.local  / demo-password-123   → "Demo · Atlas Gadgets" (owner)
 *   other@codflow.local / other-password-123  → "Demo · Other Business" (owner; used to show tenant isolation)
 */
import { createHash } from "node:crypto";
import { PrismaClient, type NormalizedStatus, type OrderStatus } from "@prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { createWorkspace } from "../src/server/repositories/workspaces";
import { normalizeCreativeKey, normalizeReference } from "../src/lib/normalize";
import { hashPhone, maskPhone } from "../src/lib/pii";

const db = new PrismaClient();
const DZD = (major: number) => Math.round(major * 100);
const DAY = 86_400_000;

// Deterministic PRNG so the demo looks the same on every seed.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const WILAYAS = ["الجزائر", "وهران", "قسنطينة", "سطيف", "البليدة", "بجاية", "تيزي وزو", "عنابة", "باتنة", "تلمسان"] as const;

const STATUS_PATHS: Record<string, string[]> = {
  delivered: ["pending", "preparing", "packaged", "dispatched", "in delivery", "delivered"],
  returned: ["pending", "preparing", "dispatched", "in delivery", "returning", "return-received"],
  shipped: ["pending", "preparing", "dispatched", "in delivery"],
  canceled: ["pending", "canceled"],
  lost: ["pending", "preparing", "dispatched", "lost"],
  exchanged: ["pending", "preparing", "dispatched", "in delivery", "delivered", "exchanged"],
  unknownA: ["pending", "preparing", "dispatched", "held_at_hub"],
  unknownB: ["pending", "dispatched", "adresse_incorrecte"],
};
const NORMAL: Record<string, NormalizedStatus> = {
  pending: "PENDING", preparing: "CONFIRMED", packaged: "CONFIRMED", dispatched: "SHIPPED", "in delivery": "SHIPPED",
  delivered: "DELIVERED", returning: "RETURNED", "return-received": "RETURNED", lost: "LOST", canceled: "CANCELED", exchanged: "EXCHANGED",
};
const norm = (s: string): NormalizedStatus => NORMAL[s] ?? "UNKNOWN";

async function resetDemo() {
  const emails = ["demo@codflow.local", "other@codflow.local", "analyst@codflow.local"];
  await db.workspace.deleteMany({ where: { isDemo: true } });
  await db.user.deleteMany({ where: { email: { in: emails } } });
}

async function seedMain() {
  const user = await db.user.create({ data: { email: "demo@codflow.local", name: "Demo Owner", passwordHash: await hashPassword("demo-password-123") } });
  const analyst = await db.user.create({ data: { email: "analyst@codflow.local", name: "Demo Analyst", passwordHash: await hashPassword("demo-password-123") } });
  const ws = await createWorkspace(user.id, { name: "Demo · Atlas Gadgets", isDemo: true });
  await db.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: ws.id, userId: analyst.id } }, create: { workspaceId: ws.id, userId: analyst.id, role: "ANALYST" }, update: {} });
  const w = ws.id;
  // A 60-order demo needs smaller samples than a real store to show verdicts.
  await db.workspace.update({ where: { id: w }, data: { verdictThresholds: { minSampleOrders: 5, targetPoas: 0.3, minDeliveryRate: 0.55, maxRtoRate: 0.3, acceptablePlacedCpa: DZD(800), minShippedForRates: 4 } } });
  const now = Date.now();
  const start = new Date(now - 45 * DAY);

  // ── Products + cost versions (Posture corrector had a supplier price increase 20 days ago)
  const catalog = [
    { name: "Posture Corrector Pro", sku: "PC-01", price: 3900, cost: 900, ship: 600, rto: 250, call: 120, pack: 50 },
    { name: "Mini Blender Go", sku: "MB-02", price: 4900, cost: 1500, ship: 700, rto: 300, call: 120, pack: 90 },
    { name: "LED Night Lamp", sku: "LN-03", price: 2900, cost: 600, ship: 600, rto: 250, call: 120, pack: 40 },
  ];
  const products = [];
  for (const c of catalog) {
    const p = await db.product.create({ data: { workspaceId: w, name: c.name, sku: c.sku, currency: "DZD" } });
    const firstTo = c.sku === "PC-01" ? new Date(now - 20 * DAY) : null;
    await db.productCostVersion.create({
      data: { workspaceId: w, productId: p.id, effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: firstTo, salePrice: DZD(c.price), sourcingCost: DZD(c.cost), forwardShippingFee: DZD(c.ship), rtoFee: DZD(c.rto), callCenterFee: DZD(c.call), packagingFee: DZD(c.pack), note: "Initial cost assumptions", createdById: user.id },
    });
    if (firstTo) {
      await db.productCostVersion.create({
        data: { workspaceId: w, productId: p.id, effectiveFrom: firstTo, salePrice: DZD(c.price), sourcingCost: DZD(1050), forwardShippingFee: DZD(c.ship), rtoFee: DZD(c.rto), callCenterFee: DZD(c.call), packagingFee: DZD(c.pack), note: "Supplier price increase", createdById: user.id },
      });
    }
    products.push({ ...p, ...c });
  }

  // ── 8 creatives
  const creativeDefs = [
    ["cr_pc_ugc_01", 0, "PC | UGC testimonial"], ["cr_pc_demo_02", 0, "PC | Before/after demo"], ["cr_pc_static_03", 0, "PC | Static offer"],
    ["cr_mb_ugc_01", 1, "MB | UGC smoothie"], ["cr_mb_recipe_02", 1, "MB | Recipe reel"], ["cr_mb_static_03", 1, "MB | Static discount"],
    ["cr_ln_ugc_01", 2, "LN | Kids room UGC"], ["cr_ln_story_02", 2, "LN | Story ad"],
  ] as const;
  const creatives = [];
  for (const [ext, pi, name] of creativeDefs) {
    creatives.push(
      await db.creative.create({
        data: { workspaceId: w, platform: "META", externalCreativeId: ext, normalizedKey: normalizeCreativeKey(ext), name, campaignId: `camp_${products[pi].sku}`, campaignName: `${products[pi].sku} | Conversions | DZ`, adsetName: "Broad 18-45", productId: products[pi].id },
      }),
    );
  }

  // ── Their campaigns: Posture Corrector and Mini Blender are linked to their product, the lamp's
  // campaign isn't yet, so its spend counts for no product until someone links it.
  for (const pi of [0, 1, 2]) {
    const pr = products[pi];
    await db.campaign.create({ data: { workspaceId: w, platform: "META", externalId: `camp_${pr.sku}`, name: `${pr.sku} | Conversions | DZ`, productId: pi < 2 ? pr.id : null } });
  }

  // ── Import batch with one failed row
  const batch = await db.importBatch.create({
    data: { workspaceId: w, kind: "ORDERS", status: "PARTIAL", fileName: "demo-orders-easysell.csv", fileSize: 18_432, totalRows: 61, importedRows: 60, duplicateRows: 0, errorRows: 1, createdById: user.id, finishedAt: new Date(now - 1 * DAY), columnMapping: { orderNumber: "Order #", placedAt: "Created at" } },
  });
  await db.importRowError.create({
    data: { workspaceId: w, batchId: batch.id, rowNumber: 17, field: "placedAt", message: 'Invalid date "31/02/2026"', rawRow: { "Order #": "ES-10017", "Created at": "31/02/2026", Product: "PC-01" } },
  });

  // ── 60 orders: 6 canceled, 5 pending, 49 confirmed (48 shipped; one of them split into 2 parcels)
  const statuses: OrderStatus[] = [...Array(6).fill("CANCELED"), ...Array(5).fill("PENDING"), ...Array(49).fill("CONFIRMED")];
  for (let i = statuses.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [statuses[i], statuses[j]] = [statuses[j], statuses[i]];
  }
  const parcelPlan = [
    ...Array(26).fill("delivered"), ...Array(8).fill("returned"), ...Array(8).fill("shipped"),
    ...Array(2).fill("canceled"), ...Array(2).fill("lost"), "exchanged", "unknownA", "unknownB",
  ];
  let parcelIdx = 0;
  let confirmedSeen = 0;
  let trackingSeq = 1000;

  for (let i = 0; i < 60; i++) {
    const creative = i % 11 === 10 ? null : creatives[Math.floor(rand() * creatives.length)];
    const product = creative ? products[creativeDefs.findIndex((d) => d[0] === creative.externalCreativeId) >= 0 ? creativeDefs.find((d) => d[0] === creative.externalCreativeId)![1] : 0] : pick(products);
    const qty = rand() < 0.12 ? 2 : 1;
    const placedAt = new Date(start.getTime() + Math.floor(rand() * 40 * DAY));
    const status = statuses[i];
    const orderNumber = `ES-${10001 + i}`;
    const phone = `05${Math.floor(10_000_000 + rand() * 89_999_999)}`;
    const wilaya = pick(WILAYAS);
    const order = await db.order.create({
      data: {
        workspaceId: w, source: "EASYSELL", externalOrderId: `es_${100000 + i}`, orderNumber, normalizedOrderNumber: normalizeReference(orderNumber),
        placedAt, status, confirmedAt: status === "CONFIRMED" ? new Date(placedAt.getTime() + 3 * 3600_000) : null, canceledAt: status === "CANCELED" ? new Date(placedAt.getTime() + 5 * 3600_000) : null,
        phoneHash: hashPhone(phone, w), phoneMasked: maskPhone(phone), wilaya, city: wilaya, codAmount: DZD(product.price * qty), currency: "DZD",
        utmSource: creative ? "facebook" : null, utmMedium: creative ? "paid" : null, utmCampaign: creative ? `${product.sku} | Conversions | DZ` : null, utmContent: creative?.externalCreativeId ?? null,
        tags: qty > 1 ? "bundle" : null, importBatchId: batch.id,
        lines: { create: { workspaceId: w, productId: product.id, sku: product.sku, productName: product.name, quantity: qty, unitPrice: DZD(product.price), currency: "DZD" } },
        attribution: { create: { workspaceId: w, orderPlacedAt: placedAt, creativeId: creative?.id ?? null, rawUtmContent: creative?.externalCreativeId ?? null, normalizedCreativeKey: creative ? normalizeCreativeKey(creative.externalCreativeId) : null, method: creative ? "UTM_CONTENT" : "NONE", confidence: creative ? 1 : 0 } },
      },
    });
    if (status !== "CONFIRMED") continue;
    confirmedSeen++;
    if (confirmedSeen === 49) continue; // confirmed but not shipped yet
    const parcelsForOrder = confirmedSeen === 3 ? 2 : 1; // one partial shipment: 2 parcels
    for (let k = 0; k < parcelsForOrder; k++) {
      const plan = parcelPlan[parcelIdx++];
      const path = STATUS_PATHS[plan];
      const trackingId = `MDM-DEMO-${trackingSeq++}`;
      const t0 = placedAt.getTime() + 6 * 3600_000;
      const events = path.map((s, n) => ({ providerStatus: s, normalizedStatus: norm(s), occurredAt: new Date(Math.min(t0 + n * 0.8 * DAY, now - 3600_000)) }));
      const last = events[events.length - 1];
      const cod = parcelsForOrder === 2 ? Math.round(order.codAmount / 2) : order.codAmount;
      const parcel = await db.parcel.create({
        data: {
          workspaceId: w, orderId: order.id, provider: "MDM_EXPRESS", trackingId, providerReference: orderNumber, providerStatus: last.providerStatus, normalizedStatus: last.normalizedStatus,
          codAmount: cod, currency: "DZD", shippingFee: DZD(product.ship), returnFee: DZD(product.rto), wilaya,
          dispatchedAt: events.find((e) => e.providerStatus === "dispatched")?.occurredAt ?? null,
          deliveredAt: last.normalizedStatus === "DELIVERED" ? last.occurredAt : null,
          returnedAt: last.normalizedStatus === "RETURNED" ? last.occurredAt : null,
          lastProviderUpdateAt: last.occurredAt, matchMethod: "ORDER_REFERENCE", matchConfidence: 1, isDemoFixture: true,
          events: { create: events.map((e) => ({ workspaceId: w, ...e, source: "DEMO_FIXTURE", eventHash: sha(`${trackingId}|${e.providerStatus}|${e.occurredAt.toISOString()}`) })) },
        },
      });
      if (last.normalizedStatus === "DELIVERED") {
        await db.cashEvent.create({ data: { workspaceId: w, type: "COD_COLLECTED", parcelId: parcel.id, orderId: order.id, amount: cod, occurredAt: last.occurredAt, externalRef: `demo-cod-${trackingId}` } });
        if (rand() < 0.7) {
          await db.cashEvent.create({ data: { workspaceId: w, type: "REMITTED", parcelId: parcel.id, orderId: order.id, amount: cod, occurredAt: new Date(last.occurredAt.getTime() + 3 * DAY), externalRef: `demo-remit-${trackingId}` } });
        }
      }
    }
  }

  // ── One unmatched MDM parcel (reference does not match any order) → review queue
  const orphan = await db.parcel.create({
    data: {
      workspaceId: w, provider: "MDM_EXPRESS", trackingId: `MDM-DEMO-${trackingSeq++}`, providerReference: "ES-99999", providerStatus: "delivered", normalizedStatus: "DELIVERED",
      codAmount: DZD(3900), wilaya: "وهران", deliveredAt: new Date(now - 2 * DAY), lastProviderUpdateAt: new Date(now - 2 * DAY), isDemoFixture: true,
      events: { create: [{ workspaceId: w, providerStatus: "delivered", normalizedStatus: "DELIVERED", occurredAt: new Date(now - 2 * DAY), source: "DEMO_FIXTURE", eventHash: sha("orphan-delivered") }] },
    },
  });
  await db.unmatchedRecord.create({ data: { workspaceId: w, provider: "MDM_EXPRESS", entityType: "parcel", externalId: orphan.trackingId, reference: "ES-99999", reason: "No local order with reference ES-99999, no linked tracking ID, no source-order ID in metadata", parcelId: orphan.id } });

  // ── Ad spend per creative per day + unmatched spend
  const SPEND_FACTOR: Record<string, number> = { cr_pc_ugc_01: 0.6, cr_pc_demo_02: 1.2, cr_pc_static_03: 0.5, cr_mb_ugc_01: 0.7, cr_mb_recipe_02: 0.5, cr_mb_static_03: 1.6, cr_ln_ugc_01: 0.4, cr_ln_story_02: 0.8 };
  for (let d = 0; d < 40; d++) {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + d));
    for (const c of creatives) {
      if (rand() < 0.2) continue;
      // Skewed per creative so the demo shows a spread of verdicts.
      const factor = SPEND_FACTOR[c.externalCreativeId] ?? 1;
      const spend = DZD(Math.round((40 + rand() * 70) * factor));
      const row = `${date.toISOString().slice(0, 10)}|${c.externalCreativeId}`;
      await db.adSpend.create({
        data: { workspaceId: w, platform: "META", source: "META_CSV", date, campaignId: c.campaignId, campaignName: c.campaignName, adsetName: c.adsetName, adId: `ad_${c.externalCreativeId}`, adName: c.name, externalCreativeId: c.externalCreativeId, creativeId: c.id, spend, impressions: Math.round(spend / 12), clicks: Math.round(spend / 900), sourceRowHash: sha(row) },
      });
    }
  }
  for (let d = 0; d < 3; d++) {
    const date = new Date(now - (d + 2) * DAY);
    await db.adSpend.create({ data: { workspaceId: w, platform: "META", source: "META_CSV", date, campaignName: "Old test | DZ", adName: "Unknown creative", externalCreativeId: "cr_unknown_77", creativeId: null, spend: DZD(350), sourceRowHash: sha(`unmatched-${d}`) } });
  }

  // ── Expenses: global + product-specific
  const month = (offset: number, day: number) => new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - offset, day, 12));
  const expenses = [
    [0, 1, "SOFTWARE", 4500, "Shopify plan", "GLOBAL", null, "FIXED"], [1, 1, "SOFTWARE", 4500, "Shopify plan", "GLOBAL", null, "FIXED"],
    [0, 3, "AI_TOOLS", 2800, "AI copy + image tools", "GLOBAL", null, "FIXED"], [1, 3, "AI_TOOLS", 2800, "AI copy + image tools", "GLOBAL", null, "FIXED"],
    [0, 5, "DOMAINS_PROXIES", 1500, "Domain + proxy", "GLOBAL", null, "FIXED"], [0, 10, "OFFICE", 3000, "Coworking desk", "GLOBAL", null, "FIXED"],
    [1, 10, "OFFICE", 3000, "Coworking desk", "GLOBAL", null, "FIXED"], [0, 12, "BANK_FEES", 650, "Card fees", "GLOBAL", null, "VARIABLE"],
    [0, 8, "PACKAGING", 6000, "Blender protective boxes", "PRODUCT", 1, "VARIABLE"], [1, 20, "WAREHOUSE", 2000, "Storage shelf rent", "GLOBAL", null, "FIXED"],
    [0, 15, "OTHER", 3000, "Product photos (lamp)", "PRODUCT", 2, "FIXED"],
  ] as const;
  for (const [off, day, category, amount, description, allocation, pi, costType] of expenses) {
    await db.expense.create({ data: { workspaceId: w, date: month(off, day), category, amount: DZD(amount), description, allocation, productId: pi === null ? null : products[pi].id, costType, createdById: user.id } });
  }
  for (const [i, desc, amt] of [[0, "CB PAYPAL *FACEBOOK", -9500], [1, "VIR RECU MDM EXPRESS", 48200]] as const) {
    await db.bankTransaction.create({ data: { workspaceId: w, date: new Date(now - (i + 3) * DAY), description: desc, amount: DZD(amt), rowHash: sha(`bank-${i}`) } });
  }

  await db.auditLog.create({ data: { workspaceId: w, actorUserId: user.id, action: "demo.seeded", metadata: { note: "Synthetic demo data" } } });
  return { w, parcels: parcelIdx + 1 };
}

async function seedOther() {
  const user = await db.user.create({ data: { email: "other@codflow.local", name: "Other Owner", passwordHash: await hashPassword("other-password-123") } });
  const ws = await createWorkspace(user.id, { name: "Demo · Other Business", isDemo: true });
  const p = await db.product.create({ data: { workspaceId: ws.id, name: "Secret Serum", sku: "SS-01", costVersions: { create: { workspaceId: ws.id, effectiveFrom: new Date("2000-01-01T00:00:00Z"), salePrice: DZD(5500), sourcingCost: DZD(1200), forwardShippingFee: DZD(600), rtoFee: DZD(250), callCenterFee: DZD(100), packagingFee: DZD(60) } } } });
  for (let i = 0; i < 5; i++) {
    const n = `OB-${500 + i}`;
    await db.order.create({ data: { workspaceId: ws.id, source: "SHOPIFY", externalOrderId: `sh_${i}`, orderNumber: n, normalizedOrderNumber: normalizeReference(n), placedAt: new Date(Date.now() - i * DAY), codAmount: DZD(5500), wilaya: "وهران", lines: { create: { workspaceId: ws.id, productId: p.id, sku: p.sku, productName: p.name, quantity: 1, unitPrice: DZD(5500) } } } });
  }
}

async function main() {
  await resetDemo();
  const main = await seedMain();
  await seedOther();
  const counts = await Promise.all([db.product.count({ where: { workspaceId: main.w } }), db.creative.count({ where: { workspaceId: main.w } }), db.order.count({ where: { workspaceId: main.w } }), db.parcel.count({ where: { workspaceId: main.w } })]);
  console.log(`Seeded demo workspace: ${counts[0]} products, ${counts[1]} creatives, ${counts[2]} orders, ${counts[3]} parcels.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
