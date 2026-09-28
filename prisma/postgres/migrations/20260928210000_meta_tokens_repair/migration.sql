-- Repair for databases that ran the first version of 20260928160000_meta_ad_spend.
-- That migration was later rewritten under the same name to add Meta tokens (one per
-- Business Manager), so databases that had already run it never got the MetaToken table
-- or AdAccount.tokenId, and Settings > Meta ads could not load. Every statement below is
-- a no-op where they already exist.

-- CreateTable
CREATE TABLE IF NOT EXISTS "MetaToken" (
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

-- AlterTable
ALTER TABLE "AdAccount" ADD COLUMN IF NOT EXISTS "tokenId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdAccount_tokenId_idx" ON "AdAccount"("tokenId");
CREATE INDEX IF NOT EXISTS "MetaToken_workspaceId_idx" ON "MetaToken"("workspaceId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdAccount_tokenId_fkey') THEN
    ALTER TABLE "AdAccount" ADD CONSTRAINT "AdAccount_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "MetaToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MetaToken_workspaceId_fkey') THEN
    ALTER TABLE "MetaToken" ADD CONSTRAINT "MetaToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- A token saved with the first version sat on the connection itself, which is no longer
-- read. Until a token is saved in the new list, the connection is not configured.
UPDATE "IntegrationConnection" AS c
SET "status" = 'NOT_CONFIGURED', "lastError" = NULL
WHERE c."provider" = 'META_ADS'
  AND NOT EXISTS (SELECT 1 FROM "MetaToken" AS t WHERE t."workspaceId" = c."workspaceId");
