-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerEncrypted" TEXT,
ADD COLUMN     "customerKeyVersion" INTEGER,
ADD COLUMN     "deliveryType" TEXT,
ADD COLUMN     "mdmStatus" TEXT,
ADD COLUMN     "mdmStatusAt" TIMESTAMP(3),
ADD COLUMN     "storeName" TEXT;

-- The next MDM sync reads every order once, so orders synced before this change get their
-- exact MDM status and customer details.
UPDATE "IntegrationConnection" SET "ordersSyncedAt" = NULL WHERE "provider" = 'MDM_EXPRESS';
