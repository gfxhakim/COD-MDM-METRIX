-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'META',
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "adAccountId" TEXT,
    "status" TEXT,
    "statusCheckedAt" DATETIME,
    "productId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Campaign_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AdAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'META',
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "currency" TEXT,
    "timezone" TEXT,
    "accountStatus" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "tokenId" TEXT,
    "lastSeenAt" DATETIME,
    "lastSyncedAt" DATETIME,
    "lastError" TEXT,
    "defaultProductId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AdAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AdAccount_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "MetaToken" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AdAccount_defaultProductId_fkey" FOREIGN KEY ("defaultProductId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AdAccount" ("accountStatus", "createdAt", "currency", "enabled", "externalId", "id", "lastError", "lastSeenAt", "lastSyncedAt", "name", "platform", "timezone", "tokenId", "updatedAt", "workspaceId") SELECT "accountStatus", "createdAt", "currency", "enabled", "externalId", "id", "lastError", "lastSeenAt", "lastSyncedAt", "name", "platform", "timezone", "tokenId", "updatedAt", "workspaceId" FROM "AdAccount";
DROP TABLE "AdAccount";
ALTER TABLE "new_AdAccount" RENAME TO "AdAccount";
CREATE INDEX "AdAccount_tokenId_idx" ON "AdAccount"("tokenId");
CREATE UNIQUE INDEX "AdAccount_workspaceId_platform_externalId_key" ON "AdAccount"("workspaceId", "platform", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Campaign_workspaceId_adAccountId_idx" ON "Campaign"("workspaceId", "adAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_workspaceId_platform_externalId_key" ON "Campaign"("workspaceId", "platform", "externalId");

