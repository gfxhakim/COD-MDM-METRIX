-- AlterTable
ALTER TABLE "IntegrationConnection" ADD COLUMN "lastSyncAttemptAt" DATETIME;
ALTER TABLE "IntegrationConnection" ADD COLUMN "lastSyncSummary" JSONB;
ALTER TABLE "IntegrationConnection" ADD COLUMN "syncLeaseUntil" DATETIME;

-- CreateTable
CREATE TABLE "AdAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'META',
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "currency" TEXT,
    "timezone" TEXT,
    "accountStatus" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" DATETIME,
    "lastSyncedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AdAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AdSpend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'META',
    "source" TEXT NOT NULL DEFAULT 'META_CSV',
    "date" DATETIME NOT NULL,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "adsetId" TEXT,
    "adsetName" TEXT,
    "adId" TEXT,
    "adName" TEXT,
    "externalCreativeId" TEXT,
    "creativeId" TEXT,
    "spend" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "originalSpend" INTEGER,
    "originalCurrency" TEXT,
    "fxRate" REAL,
    "impressions" INTEGER,
    "clicks" INTEGER,
    "sourceRowHash" TEXT NOT NULL,
    "importBatchId" TEXT,
    "adAccountId" TEXT,
    "supersededAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdSpend_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AdSpend_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Creative" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AdSpend_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AdSpend" ("adId", "adName", "adsetId", "adsetName", "campaignId", "campaignName", "clicks", "createdAt", "creativeId", "currency", "date", "externalCreativeId", "fxRate", "id", "importBatchId", "impressions", "originalCurrency", "originalSpend", "platform", "source", "sourceRowHash", "spend", "workspaceId") SELECT "adId", "adName", "adsetId", "adsetName", "campaignId", "campaignName", "clicks", "createdAt", "creativeId", "currency", "date", "externalCreativeId", "fxRate", "id", "importBatchId", "impressions", "originalCurrency", "originalSpend", "platform", "source", "sourceRowHash", "spend", "workspaceId" FROM "AdSpend";
DROP TABLE "AdSpend";
ALTER TABLE "new_AdSpend" RENAME TO "AdSpend";
CREATE INDEX "AdSpend_workspaceId_adId_date_idx" ON "AdSpend"("workspaceId", "adId", "date");
CREATE INDEX "AdSpend_workspaceId_date_idx" ON "AdSpend"("workspaceId", "date");
CREATE INDEX "AdSpend_workspaceId_creativeId_date_idx" ON "AdSpend"("workspaceId", "creativeId", "date");
CREATE UNIQUE INDEX "AdSpend_workspaceId_source_sourceRowHash_key" ON "AdSpend"("workspaceId", "source", "sourceRowHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "AdAccount_workspaceId_platform_externalId_key" ON "AdAccount"("workspaceId", "platform", "externalId");

