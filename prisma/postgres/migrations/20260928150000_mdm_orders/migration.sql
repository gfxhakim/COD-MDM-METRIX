-- AlterEnum
ALTER TYPE "MatchMethod" ADD VALUE 'MDM_ORDER';

-- AlterEnum
ALTER TYPE "OrderSource" ADD VALUE 'MDM_EXPRESS';

-- AlterTable
ALTER TABLE "IntegrationConnection" ADD COLUMN     "ordersSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "mdmHistoryCheckedAt" TIMESTAMP(3),
ADD COLUMN     "mdmOrderId" TEXT;

-- AlterTable
ALTER TABLE "Parcel" ADD COLUMN     "mdmOrderId" TEXT;

-- AlterTable
ALTER TABLE "SyncJob" ADD COLUMN     "ordersAddedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ordersNote" TEXT,
ADD COLUMN     "ordersUpdatedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ordersWithContentCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "phase" TEXT NOT NULL DEFAULT 'PARCELS';

-- CreateIndex
CREATE UNIQUE INDEX "Order_workspaceId_mdmOrderId_key" ON "Order"("workspaceId", "mdmOrderId");

-- CreateIndex
CREATE INDEX "Parcel_workspaceId_mdmOrderId_idx" ON "Parcel"("workspaceId", "mdmOrderId");

