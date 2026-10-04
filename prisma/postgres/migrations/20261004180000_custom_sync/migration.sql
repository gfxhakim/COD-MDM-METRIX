-- Custom syncs: the filters a user picked, how many MDM orders matched them, and how many didn't.
-- AlterTable
ALTER TABLE "SyncJob" ADD COLUMN     "filters" JSONB,
ADD COLUMN     "ordersMatchedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "skippedCount" INTEGER NOT NULL DEFAULT 0;
