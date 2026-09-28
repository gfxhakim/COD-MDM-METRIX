-- AlterTable
ALTER TABLE "AdSpend" ADD COLUMN "fxRate" REAL;
ALTER TABLE "AdSpend" ADD COLUMN "originalCurrency" TEXT;
ALTER TABLE "AdSpend" ADD COLUMN "originalSpend" INTEGER;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "sourceRowHash" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "source" TEXT,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "updatedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "columnMapping" JSONB,
    "options" JSONB,
    "summary" JSONB,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "ImportBatch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ImportBatch" ("columnMapping", "createdAt", "createdById", "duplicateRows", "errorRows", "fileName", "fileSize", "finishedAt", "id", "importedRows", "kind", "status", "totalRows", "workspaceId") SELECT "columnMapping", "createdAt", "createdById", "duplicateRows", "errorRows", "fileName", "fileSize", "finishedAt", "id", "importedRows", "kind", "status", "totalRows", "workspaceId" FROM "ImportBatch";
DROP TABLE "ImportBatch";
ALTER TABLE "new_ImportBatch" RENAME TO "ImportBatch";
CREATE INDEX "ImportBatch_workspaceId_kind_createdAt_idx" ON "ImportBatch"("workspaceId", "kind", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Expense_workspaceId_sourceRowHash_key" ON "Expense"("workspaceId", "sourceRowHash");

