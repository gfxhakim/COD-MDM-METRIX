-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN "mdmProductId" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "mdmVariantId" TEXT;

-- CreateTable
CREATE TABLE "MdmProductLink" (
    "workspaceId" TEXT NOT NULL,
    "mdmProductId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mdmName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("workspaceId", "mdmProductId"),
    CONSTRAINT "MdmProductLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MdmProductLink_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "normalizedOrderNumber" TEXT NOT NULL,
    "placedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "confirmedAt" DATETIME,
    "canceledAt" DATETIME,
    "callAttempts" INTEGER,
    "phoneHash" TEXT,
    "phoneMasked" TEXT,
    "customerRef" TEXT,
    "wilaya" TEXT,
    "city" TEXT,
    "codAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "tags" TEXT,
    "notes" TEXT,
    "importBatchId" TEXT,
    "mdmOrderId" TEXT,
    "mdmStatus" TEXT,
    "mdmStatusAt" DATETIME,
    "customerEncrypted" TEXT,
    "customerKeyVersion" INTEGER,
    "deliveryType" TEXT,
    "storeName" TEXT,
    "mdmHistoryCheckedAt" DATETIME,
    "mdmUpsell" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Order_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("callAttempts", "canceledAt", "city", "codAmount", "confirmedAt", "createdAt", "currency", "customerEncrypted", "customerKeyVersion", "customerRef", "deliveryType", "externalOrderId", "id", "importBatchId", "mdmHistoryCheckedAt", "mdmOrderId", "mdmStatus", "mdmStatusAt", "normalizedOrderNumber", "notes", "orderNumber", "phoneHash", "phoneMasked", "placedAt", "source", "status", "storeName", "tags", "updatedAt", "utmCampaign", "utmContent", "utmMedium", "utmSource", "wilaya", "workspaceId") SELECT "callAttempts", "canceledAt", "city", "codAmount", "confirmedAt", "createdAt", "currency", "customerEncrypted", "customerKeyVersion", "customerRef", "deliveryType", "externalOrderId", "id", "importBatchId", "mdmHistoryCheckedAt", "mdmOrderId", "mdmStatus", "mdmStatusAt", "normalizedOrderNumber", "notes", "orderNumber", "phoneHash", "phoneMasked", "placedAt", "source", "status", "storeName", "tags", "updatedAt", "utmCampaign", "utmContent", "utmMedium", "utmSource", "wilaya", "workspaceId" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE INDEX "Order_workspaceId_normalizedOrderNumber_idx" ON "Order"("workspaceId", "normalizedOrderNumber");
CREATE INDEX "Order_workspaceId_placedAt_idx" ON "Order"("workspaceId", "placedAt");
CREATE INDEX "Order_workspaceId_status_idx" ON "Order"("workspaceId", "status");
CREATE INDEX "Order_workspaceId_wilaya_idx" ON "Order"("workspaceId", "wilaya");
CREATE INDEX "Order_confirmedAt_idx" ON "Order"("confirmedAt");
CREATE UNIQUE INDEX "Order_workspaceId_source_externalOrderId_key" ON "Order"("workspaceId", "source", "externalOrderId");
CREATE UNIQUE INDEX "Order_workspaceId_mdmOrderId_key" ON "Order"("workspaceId", "mdmOrderId");
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "fromMdm" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("active", "createdAt", "currency", "id", "name", "sku", "updatedAt", "workspaceId") SELECT "active", "createdAt", "currency", "id", "name", "sku", "updatedAt", "workspaceId" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE INDEX "Product_workspaceId_active_idx" ON "Product"("workspaceId", "active");
CREATE UNIQUE INDEX "Product_workspaceId_sku_key" ON "Product"("workspaceId", "sku");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "MdmProductLink_productId_idx" ON "MdmProductLink"("productId");

-- CreateIndex
CREATE INDEX "OrderLine_workspaceId_mdmProductId_idx" ON "OrderLine"("workspaceId", "mdmProductId");


-- MDM order lines now carry MDM product IDs and orders an upsell flag: re-read every MDM order once.
UPDATE "IntegrationConnection" SET "ordersSyncedAt" = NULL WHERE "provider" = 'MDM_EXPRESS';
