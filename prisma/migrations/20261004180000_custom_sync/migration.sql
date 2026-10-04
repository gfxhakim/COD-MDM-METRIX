-- Custom syncs: the filters a user picked, how many MDM orders matched them, and how many didn't.
ALTER TABLE "SyncJob" ADD COLUMN "filters" JSONB;
ALTER TABLE "SyncJob" ADD COLUMN "ordersMatchedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SyncJob" ADD COLUMN "skippedCount" INTEGER NOT NULL DEFAULT 0;
