-- AlterTable
ALTER TABLE "AdAccount" ADD COLUMN     "defaultProductId" TEXT;

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" "AdPlatform" NOT NULL DEFAULT 'META',
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "adAccountId" TEXT,
    "status" TEXT,
    "statusCheckedAt" TIMESTAMP(3),
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_workspaceId_adAccountId_idx" ON "Campaign"("workspaceId", "adAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_workspaceId_platform_externalId_key" ON "Campaign"("workspaceId", "platform", "externalId");

-- AddForeignKey
ALTER TABLE "AdAccount" ADD CONSTRAINT "AdAccount_defaultProductId_fkey" FOREIGN KEY ("defaultProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

