-- AlterTable
ALTER TABLE "Order" ADD COLUMN "mdmStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN "mdmStatusAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "customerEncrypted" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerKeyVersion" INTEGER;
ALTER TABLE "Order" ADD COLUMN "deliveryType" TEXT;
ALTER TABLE "Order" ADD COLUMN "storeName" TEXT;

-- The next MDM sync reads every order once, so orders synced before this change get their
-- exact MDM status and customer details.
UPDATE "IntegrationConnection" SET "ordersSyncedAt" = NULL WHERE "provider" = 'MDM_EXPRESS';
