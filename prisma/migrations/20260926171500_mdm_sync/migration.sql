-- AlterTable
ALTER TABLE "IntegrationConnection" ADD COLUMN "credentialUpdatedAt" DATETIME;
ALTER TABLE "IntegrationConnection" ADD COLUMN "credentialUpdatedById" TEXT;

-- AlterTable
ALTER TABLE "Parcel" ADD COLUMN "sourceOrderId" TEXT;

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
INSERT INTO "new_SyncJob" ("addedCount", "cancelRequested", "createdAt", "cursor", "error", "failedCount", "finishedAt", "heartbeatAt", "id", "page", "provider", "requestedById", "startedAt", "status", "totalCount", "trigger", "unchangedCount", "unknownStatusCount", "unmatchedCount", "updatedAt", "updatedCount", "workspaceId") SELECT "addedCount", "cancelRequested", "createdAt", "cursor", "error", "failedCount", "finishedAt", "heartbeatAt", "id", "page", "provider", "requestedById", "startedAt", "status", "totalCount", "trigger", "unchangedCount", "unknownStatusCount", "unmatchedCount", "updatedAt", "updatedCount", "workspaceId" FROM "SyncJob";
DROP TABLE "SyncJob";
ALTER TABLE "new_SyncJob" RENAME TO "SyncJob";
CREATE UNIQUE INDEX "SyncJob_activeLock_key" ON "SyncJob"("activeLock");
CREATE INDEX "SyncJob_workspaceId_status_idx" ON "SyncJob"("workspaceId", "status");
CREATE INDEX "SyncJob_workspaceId_createdAt_idx" ON "SyncJob"("workspaceId", "createdAt");
CREATE INDEX "SyncJob_status_nextRunAt_idx" ON "SyncJob"("status", "nextRunAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

