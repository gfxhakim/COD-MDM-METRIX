-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'META_ADS';

-- AlterTable
ALTER TABLE "AdSpend" ADD COLUMN     "adAccountId" TEXT,
ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "IntegrationConnection" ADD COLUMN     "lastSyncAttemptAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncSummary" JSONB,
ADD COLUMN     "syncLeaseUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AdAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" "AdPlatform" NOT NULL DEFAULT 'META',
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "currency" TEXT,
    "timezone" TEXT,
    "accountStatus" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "tokenId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaToken" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "encryptedCredential" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "maskedLabel" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'UNTESTED',
    "lastTestedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "credentialUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "credentialUpdatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdAccount_tokenId_idx" ON "AdAccount"("tokenId");

-- CreateIndex
CREATE UNIQUE INDEX "AdAccount_workspaceId_platform_externalId_key" ON "AdAccount"("workspaceId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "MetaToken_workspaceId_idx" ON "MetaToken"("workspaceId");

-- CreateIndex
CREATE INDEX "AdSpend_workspaceId_adId_date_idx" ON "AdSpend"("workspaceId", "adId", "date");

-- AddForeignKey
ALTER TABLE "AdAccount" ADD CONSTRAINT "AdAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdAccount" ADD CONSTRAINT "AdAccount_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "MetaToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaToken" ADD CONSTRAINT "MetaToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

