-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "mdmUpsell" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "mdmProductId" TEXT,
ADD COLUMN     "mdmVariantId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "fromMdm" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MdmProductLink" (
    "workspaceId" TEXT NOT NULL,
    "mdmProductId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mdmName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MdmProductLink_pkey" PRIMARY KEY ("workspaceId","mdmProductId")
);

-- CreateIndex
CREATE INDEX "MdmProductLink_productId_idx" ON "MdmProductLink"("productId");

-- CreateIndex
CREATE INDEX "OrderLine_workspaceId_mdmProductId_idx" ON "OrderLine"("workspaceId", "mdmProductId");

-- AddForeignKey
ALTER TABLE "MdmProductLink" ADD CONSTRAINT "MdmProductLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MdmProductLink" ADD CONSTRAINT "MdmProductLink_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- MDM order lines now carry MDM product IDs and orders an upsell flag: re-read every MDM order once.
UPDATE "IntegrationConnection" SET "ordersSyncedAt" = NULL WHERE "provider" = 'MDM_EXPRESS';
