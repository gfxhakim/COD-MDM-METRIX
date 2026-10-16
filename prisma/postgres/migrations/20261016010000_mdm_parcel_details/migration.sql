-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "mdmArchived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Parcel" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mdmParentParcelId" TEXT,
ADD COLUMN     "mdmSubType" TEXT,
ADD COLUMN     "mdmType" TEXT,
ADD COLUMN     "paidToClient" INTEGER,
ADD COLUMN     "piecesDelivered" INTEGER,
ADD COLUMN     "piecesSent" INTEGER;

-- The next MDM sync reads every order and parcel again once, so the details above are filled in.
UPDATE "IntegrationConnection" SET "choicesWidenedAt" = CURRENT_TIMESTAMP WHERE "provider" = 'MDM_EXPRESS' AND "ordersSyncedAt" IS NOT NULL;
