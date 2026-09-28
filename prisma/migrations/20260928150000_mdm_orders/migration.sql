-- AlterTable
ALTER TABLE "IntegrationConnection" ADD COLUMN "ordersSyncedAt" DATETIME;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "mdmHistoryCheckedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "mdmOrderId" TEXT;

-- AlterTable
ALTER TABLE "Parcel" ADD COLUMN "mdmOrderId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SyncJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "trigger" TEXT NOT NULL DEFAULT 'MANUAL',
    "requestedById" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "cursor" TEXT,
    "page" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER,
    "addedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "unknownStatusCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "phase" TEXT NOT NULL DEFAULT 'PARCELS',
    "ordersAddedCount" INTEGER NOT NULL DEFAULT 0,
    "ordersUpdatedCount" INTEGER NOT NULL DEFAULT 0,
    "ordersWithContentCount" INTEGER NOT NULL DEFAULT 0,
    "ordersNote" TEXT,
    "error" TEXT,
    "heartbeatAt" DATETIME,
    "mode" TEXT NOT NULL DEFAULT 'INCREMENTAL',
    "adapter" TEXT NOT NULL DEFAULT 'mock',
    "updatedSince" DATETIME,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" DATETIME,
    "retryOfJobId" TEXT,
    "activeLock" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SyncJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SyncJob" ("activeLock", "adapter", "addedCount", "attempt", "cancelRequested", "createdAt", "cursor", "error", "failedCount", "finishedAt", "heartbeatAt", "id", "mode", "nextRunAt", "page", "provider", "requestedById", "retryOfJobId", "startedAt", "status", "totalCount", "trigger", "unchangedCount", "unknownStatusCount", "unmatchedCount", "updatedAt", "updatedCount", "updatedSince", "workspaceId") SELECT "activeLock", "adapter", "addedCount", "attempt", "cancelRequested", "createdAt", "cursor", "error", "failedCount", "finishedAt", "heartbeatAt", "id", "mode", "nextRunAt", "page", "provider", "requestedById", "retryOfJobId", "startedAt", "status", "totalCount", "trigger", "unchangedCount", "unknownStatusCount", "unmatchedCount", "updatedAt", "updatedCount", "updatedSince", "workspaceId" FROM "SyncJob";
DROP TABLE "SyncJob";
ALTER TABLE "new_SyncJob" RENAME TO "SyncJob";
CREATE UNIQUE INDEX "SyncJob_activeLock_key" ON "SyncJob"("activeLock");
CREATE INDEX "SyncJob_workspaceId_status_idx" ON "SyncJob"("workspaceId", "status");
CREATE INDEX "SyncJob_workspaceId_createdAt_idx" ON "SyncJob"("workspaceId", "createdAt");
CREATE INDEX "SyncJob_status_nextRunAt_idx" ON "SyncJob"("status", "nextRunAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Order_workspaceId_mdmOrderId_key" ON "Order"("workspaceId", "mdmOrderId");

-- CreateIndex
CREATE INDEX "Parcel_workspaceId_mdmOrderId_idx" ON "Parcel"("workspaceId", "mdmOrderId");

