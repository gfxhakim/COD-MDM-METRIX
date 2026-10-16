-- AlterTable
ALTER TABLE "Order" ADD COLUMN "mdmArchived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Parcel" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Parcel" ADD COLUMN "mdmParentParcelId" TEXT;
ALTER TABLE "Parcel" ADD COLUMN "mdmSubType" TEXT;
ALTER TABLE "Parcel" ADD COLUMN "mdmType" TEXT;
ALTER TABLE "Parcel" ADD COLUMN "paidToClient" INTEGER;
ALTER TABLE "Parcel" ADD COLUMN "piecesDelivered" INTEGER;
ALTER TABLE "Parcel" ADD COLUMN "piecesSent" INTEGER;

-- The next MDM sync reads every order and parcel again once, so the details above are filled in.
UPDATE "IntegrationConnection" SET "choicesWidenedAt" = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE "provider" = 'MDM_EXPRESS' AND "ordersSyncedAt" IS NOT NULL;
