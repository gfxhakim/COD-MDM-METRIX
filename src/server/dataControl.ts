import { Prisma } from "@prisma/client";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { InputError } from "@/server/errors";
import { refreshMetaStatus } from "@/server/meta/connection";
import { API_SOURCE } from "@/server/meta/supersede";
import { assertCan, type WorkspaceContext } from "@/server/tenancy";

/**
 * What the owner can delete from Settings > Your data: what a sync brought in, what was imported,
 * what was typed in, or all of it. Members, settings, keys (unless asked), MDM product choices and
 * the audit log always stay.
 */
export const DATA_GROUPS = ["mdm", "meta", "imports", "expenses", "products"] as const;
export type DataGroup = (typeof DATA_GROUPS)[number];
export type DeleteTarget = DataGroup | "everything";

type Tx = Prisma.TransactionClient;
const MDM = "MDM_EXPRESS" as const;
const META = "META_ADS" as const;

/** How much of each kind the business has, and whether a sync is running right now. */
export async function dataSummary(ctx: WorkspaceContext) {
  assertCan(ctx, "data.delete");
  const workspaceId = ctx.workspaceId;
  const ws = { workspaceId };
  const [
    mdmOrders, mdmParcels, mdmSyncs, mdmAccount, mdmPayouts, mdmStock, mdmBusy, mdmConn,
    metaRows, metaAds, metaDays, metaTokens, metaConn,
    files, importedOrders, importedSpend, importedExpenses, importedBank,
    expenses, recurring, categories,
    products, costVersions,
    allOrders, creatives,
  ] = await Promise.all([
    db.order.count({ where: { ...ws, source: MDM } }),
    db.parcel.count({ where: { ...ws, provider: MDM } }),
    db.syncJob.count({ where: { ...ws, provider: MDM } }),
    db.mdmAccount.count({ where: ws }),
    db.mdmPayout.count({ where: ws }),
    db.mdmStockItem.count({ where: ws }),
    db.syncJob.count({ where: { ...ws, provider: MDM, activeLock: { not: null } } }),
    db.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: MDM } }, select: { encryptedCredential: true } }),
    db.adSpend.count({ where: { ...ws, source: API_SOURCE } }),
    db.adSpend.groupBy({ by: ["adId"], where: { ...ws, source: API_SOURCE } }),
    db.adSpend.aggregate({ where: { ...ws, source: API_SOURCE }, _min: { date: true }, _max: { date: true } }),
    db.metaToken.count({ where: ws }),
    db.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: META } }, select: { syncLeaseUntil: true } }),
    db.importBatch.count({ where: ws }),
    db.order.count({ where: { ...ws, importBatchId: { not: null } } }),
    db.adSpend.count({ where: { ...ws, importBatchId: { not: null } } }),
    db.expense.count({ where: { ...ws, importBatchId: { not: null } } }),
    db.bankTransaction.count({ where: { ...ws, importBatchId: { not: null } } }),
    db.expense.count({ where: { ...ws, importBatchId: null, bankTransactionId: null } }),
    db.recurringExpense.count({ where: ws }),
    db.customExpenseCategory.count({ where: ws }),
    db.product.count({ where: ws }),
    db.productCostVersion.count({ where: ws }),
    db.order.count({ where: ws }),
    db.creative.count({ where: ws }),
  ]);
  const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
  return {
    mdm: { orders: mdmOrders, parcels: mdmParcels, syncs: mdmSyncs, money: mdmAccount + mdmPayouts + mdmStock > 0, keySaved: !!mdmConn?.encryptedCredential, busy: mdmBusy > 0 },
    meta: { spendRows: metaRows, ads: metaAds.filter((a) => a.adId).length, from: day(metaDays._min.date), to: day(metaDays._max.date), tokens: metaTokens, busy: !!metaConn?.syncLeaseUntil && metaConn.syncLeaseUntil > new Date() },
    imports: { files, orders: importedOrders, adSpend: importedSpend, expenses: importedExpenses, bankRows: importedBank },
    expenses: { expenses, recurring, categories },
    products: { products, costVersions },
    everything: { orders: allOrders, creatives },
  };
}

// ─────────────────────────── One kind at a time ───────────────────────────

/** Every imported file and what it created, as deleting each file on the Imports page would. */
async function deleteImports(tx: Tx, workspaceId: string) {
  const ws = { workspaceId };
  const bankIds = (await tx.bankTransaction.findMany({ where: { ...ws, importBatchId: { not: null } }, select: { id: true } })).map((b) => b.id);
  const bankExpenses = await tx.expense.deleteMany({ where: { ...ws, bankTransactionId: { in: bankIds } } });
  await tx.parcel.updateMany({ where: { ...ws, order: { importBatchId: { not: null } } }, data: { orderId: null, matchMethod: "NONE", matchConfidence: 0 } });
  const orders = await tx.order.deleteMany({ where: { ...ws, importBatchId: { not: null } } });
  const adSpend = await tx.adSpend.deleteMany({ where: { ...ws, importBatchId: { not: null } } });
  const expenses = await tx.expense.deleteMany({ where: { ...ws, importBatchId: { not: null } } });
  const bank = await tx.bankTransaction.deleteMany({ where: { ...ws, id: { in: bankIds } } });
  const files = await tx.importBatch.deleteMany({ where: ws });
  return { files: files.count, importedOrders: orders.count, importedAdSpend: adSpend.count, importedExpenses: expenses.count + bankExpenses.count, bankRows: bank.count };
}

/**
 * Orders, parcels, money and stock read from MDM, and the sync history. The next sync reads
 * everything MDM still has again (following the MDM product choices, which stay).
 */
async function deleteMdm(tx: Tx, workspaceId: string) {
  const ws = { workspaceId };
  const parcels = await tx.parcel.deleteMany({ where: { ...ws, provider: MDM } });
  const orders = await tx.order.deleteMany({ where: { ...ws, source: MDM } });
  // Imported or typed orders that MDM filled in keep only what came from the store or the file.
  await tx.order.updateMany({
    where: { ...ws, OR: [{ mdmOrderId: { not: null } }, { customerEncrypted: { not: null } }] },
    data: { mdmOrderId: null, mdmStatus: null, mdmStatusAt: null, customerEncrypted: null, customerKeyVersion: null, deliveryType: null, storeName: null, mdmHistoryCheckedAt: null, mdmUpsell: false },
  });
  await tx.unmatchedRecord.deleteMany({ where: { ...ws, provider: MDM } });
  await tx.rawExternalRecord.deleteMany({ where: { ...ws, provider: MDM } });
  await tx.syncJob.deleteMany({ where: { ...ws, provider: MDM, activeLock: null } });
  await tx.mdmSkippedOrder.deleteMany({ where: ws });
  await tx.mdmFee.deleteMany({ where: ws });
  await tx.mdmPayout.deleteMany({ where: ws });
  await tx.mdmStockItem.deleteMany({ where: ws });
  await tx.mdmStockArrival.deleteMany({ where: ws });
  await tx.mdmAccount.deleteMany({ where: ws });
  await tx.integrationConnection.updateMany({ where: { ...ws, provider: MDM }, data: { lastSuccessfulSyncAt: null, ordersSyncedAt: null, choicesWidenedAt: null, lastError: null } });
  return { mdmOrders: orders.count, mdmParcels: parcels.count };
}

/** Spend read from Meta. Campaigns and their product links stay; the next spend sync re-reads 180 days. */
async function deleteMeta(tx: Tx, workspaceId: string) {
  const ws = { workspaceId };
  const spend = await tx.adSpend.deleteMany({ where: { ...ws, source: API_SOURCE } });
  // Imported rows the Meta rows had replaced count again.
  await tx.adSpend.updateMany({ where: { ...ws, supersededAt: { not: null } }, data: { supersededAt: null } });
  await tx.rawExternalRecord.deleteMany({ where: { ...ws, provider: META } });
  await tx.adAccount.updateMany({ where: ws, data: { lastSyncedAt: null, lastError: null } });
  await tx.integrationConnection.updateMany({ where: { ...ws, provider: META }, data: { lastSuccessfulSyncAt: null, lastSyncSummary: Prisma.DbNull, lastError: null } });
  return { metaSpendRows: spend.count };
}

/** Expenses typed in by hand, repeating ones, and own categories nothing uses any more. */
async function deleteExpenses(tx: Tx, workspaceId: string) {
  const ws = { workspaceId };
  const expenses = await tx.expense.deleteMany({ where: { ...ws, importBatchId: null, bankTransactionId: null } });
  const recurring = await tx.recurringExpense.deleteMany({ where: ws });
  await tx.customExpenseCategory.deleteMany({ where: { ...ws, expenses: { none: {} }, recurring: { none: {} } } });
  return { expenses: expenses.count, repeatingExpenses: recurring.count };
}

/**
 * Products with their costs and saved Profit tracker numbers. Orders stay, without a product. The
 * next MDM sync re-reads every MDM order once, so MDM's products come back and its orders count
 * for them again.
 */
async function deleteProducts(tx: Tx, workspaceId: string) {
  const products = await tx.product.deleteMany({ where: { workspaceId } });
  await tx.integrationConnection.updateMany({ where: { workspaceId, provider: MDM, ordersSyncedAt: { not: null } }, data: { choicesWidenedAt: new Date() } });
  return { products: products.count };
}

/** What is left after every kind above: hand-made orders and parcels, creatives, campaigns, saved simulations. */
async function deleteRest(tx: Tx, workspaceId: string) {
  const ws = { workspaceId };
  const parcels = await tx.parcel.deleteMany({ where: ws });
  const orders = await tx.order.deleteMany({ where: ws });
  await tx.unmatchedRecord.deleteMany({ where: ws });
  await tx.cashEvent.deleteMany({ where: ws });
  await tx.expense.deleteMany({ where: ws });
  await tx.bankTransaction.deleteMany({ where: ws });
  await tx.adSpend.deleteMany({ where: ws });
  await tx.customExpenseCategory.deleteMany({ where: ws });
  const creatives = await tx.creative.deleteMany({ where: ws });
  await tx.campaign.deleteMany({ where: ws });
  await tx.simulatorScenario.deleteMany({ where: ws });
  await tx.metricSnapshot.deleteMany({ where: ws });
  await tx.rawExternalRecord.deleteMany({ where: ws });
  await tx.syncJob.deleteMany({ where: { ...ws, activeLock: null } });
  return { otherOrders: orders.count, otherParcels: parcels.count, creatives: creatives.count };
}

const DELETERS: Record<DataGroup, (tx: Tx, workspaceId: string) => Promise<Record<string, number>>> = {
  // Imported files go first, so their orders, spend and expenses leave with them.
  imports: deleteImports,
  mdm: deleteMdm,
  meta: deleteMeta,
  expenses: deleteExpenses,
  products: deleteProducts,
};

/**
 * Deletes one kind of data, or everything. `stopSyncs` also removes the MDM key and Meta tokens
 * for what is deleted, so the next sync can't bring it back. Owner only, and never while a sync
 * of that data is running.
 */
export async function deleteData(ctx: WorkspaceContext, input: { target: DeleteTarget; stopSyncs: boolean }) {
  assertCan(ctx, "data.delete");
  const workspaceId = ctx.workspaceId;
  const groups: DataGroup[] = input.target === "everything" ? Object.keys(DELETERS) as DataGroup[] : [input.target];
  const summary = await dataSummary(ctx);
  if (groups.includes("mdm") && summary.mdm.busy) throw new InputError("An MDM sync is running. Wait for it to finish, or cancel it on the MDM sync page, then try again.");
  if (groups.includes("meta") && summary.meta.busy) throw new InputError("A Meta spend sync is running. Wait a minute for it to finish, then try again.");

  const removed = await db.$transaction(
    async (tx) => {
      const r: Record<string, number> = {};
      for (const g of groups) Object.assign(r, await DELETERS[g](tx, workspaceId));
      if (input.target === "everything") Object.assign(r, await deleteRest(tx, workspaceId));
      if (input.stopSyncs && groups.includes("mdm")) {
        await tx.integrationConnection.updateMany({
          where: { workspaceId, provider: MDM },
          data: { encryptedCredential: null, keyVersion: null, maskedLabel: null, status: "NOT_CONFIGURED", lastTestedAt: null, credentialUpdatedAt: new Date(), credentialUpdatedById: ctx.userId },
        });
      }
      if (input.stopSyncs && groups.includes("meta")) await tx.metaToken.deleteMany({ where: { workspaceId } });
      await audit(ctx, "data.deleted", { type: "Workspace", id: workspaceId }, { target: input.target, stopSyncs: input.stopSyncs, ...r }, tx);
      return r;
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
  if (input.stopSyncs && groups.includes("meta")) await refreshMetaStatus(workspaceId);
  return removed;
}
