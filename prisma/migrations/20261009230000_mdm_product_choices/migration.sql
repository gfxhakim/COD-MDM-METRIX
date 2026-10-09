-- CreateTable
CREATE TABLE "MdmProductChoice" (
    "workspaceId" TEXT NOT NULL,
    "mdmProductId" TEXT NOT NULL,
    "name" TEXT,
    "bring" BOOLEAN NOT NULL DEFAULT true,
    "since" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("workspaceId", "mdmProductId"),
    CONSTRAINT "MdmProductChoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MdmSkippedOrder" (
    "workspaceId" TEXT NOT NULL,
    "mdmOrderId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("workspaceId", "mdmOrderId"),
    CONSTRAINT "MdmSkippedOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_IntegrationConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL DEFAULT 'https://api.mdm.express',
    "encryptedCredential" TEXT,
    "keyVersion" INTEGER,
    "maskedLabel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "lastTestedAt" DATETIME,
    "lastSuccessfulSyncAt" DATETIME,
    "ordersSyncedAt" DATETIME,
    "syncLeaseUntil" DATETIME,
    "lastSyncAttemptAt" DATETIME,
    "lastSyncSummary" JSONB,
    "lastError" TEXT,
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 45,
    "bringNewMdmProducts" BOOLEAN NOT NULL DEFAULT true,
    "choicesWidenedAt" DATETIME,
    "credentialUpdatedAt" DATETIME,
    "credentialUpdatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IntegrationConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_IntegrationConnection" ("baseUrl", "createdAt", "credentialUpdatedAt", "credentialUpdatedById", "encryptedCredential", "id", "keyVersion", "lastError", "lastSuccessfulSyncAt", "lastSyncAttemptAt", "lastSyncSummary", "lastTestedAt", "maskedLabel", "ordersSyncedAt", "provider", "status", "syncIntervalMinutes", "syncLeaseUntil", "updatedAt", "workspaceId") SELECT "baseUrl", "createdAt", "credentialUpdatedAt", "credentialUpdatedById", "encryptedCredential", "id", "keyVersion", "lastError", "lastSuccessfulSyncAt", "lastSyncAttemptAt", "lastSyncSummary", "lastTestedAt", "maskedLabel", "ordersSyncedAt", "provider", "status", "syncIntervalMinutes", "syncLeaseUntil", "updatedAt", "workspaceId" FROM "IntegrationConnection";
DROP TABLE "IntegrationConnection";
ALTER TABLE "new_IntegrationConnection" RENAME TO "IntegrationConnection";
CREATE UNIQUE INDEX "IntegrationConnection_workspaceId_provider_key" ON "IntegrationConnection"("workspaceId", "provider");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

