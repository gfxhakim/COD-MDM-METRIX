-- CreateTable
CREATE TABLE "CustomExpenseCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomExpenseCategory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecurringExpense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "customCategoryId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "originalAmount" INTEGER,
    "originalCurrency" TEXT,
    "fxRate" REAL,
    "frequency" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "allocation" TEXT NOT NULL DEFAULT 'GLOBAL',
    "productId" TEXT,
    "costType" TEXT NOT NULL DEFAULT 'FIXED',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecurringExpense_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecurringExpense_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RecurringExpense_customCategoryId_fkey" FOREIGN KEY ("customCategoryId") REFERENCES "CustomExpenseCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "category" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "originalAmount" INTEGER,
    "originalCurrency" TEXT,
    "fxRate" REAL,
    "description" TEXT,
    "allocation" TEXT NOT NULL DEFAULT 'GLOBAL',
    "productId" TEXT,
    "costType" TEXT NOT NULL DEFAULT 'FIXED',
    "bankTransactionId" TEXT,
    "customCategoryId" TEXT,
    "importBatchId" TEXT,
    "sourceRowHash" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Expense_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Expense_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Expense_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Expense_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Expense_customCategoryId_fkey" FOREIGN KEY ("customCategoryId") REFERENCES "CustomExpenseCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Expense" ("allocation", "amount", "bankTransactionId", "category", "costType", "createdAt", "createdById", "currency", "date", "description", "fxRate", "id", "importBatchId", "originalAmount", "originalCurrency", "productId", "sourceRowHash", "updatedAt", "workspaceId") SELECT "allocation", "amount", "bankTransactionId", "category", "costType", "createdAt", "createdById", "currency", "date", "description", "fxRate", "id", "importBatchId", "originalAmount", "originalCurrency", "productId", "sourceRowHash", "updatedAt", "workspaceId" FROM "Expense";
DROP TABLE "Expense";
ALTER TABLE "new_Expense" RENAME TO "Expense";
CREATE UNIQUE INDEX "Expense_bankTransactionId_key" ON "Expense"("bankTransactionId");
CREATE INDEX "Expense_workspaceId_date_idx" ON "Expense"("workspaceId", "date");
CREATE INDEX "Expense_workspaceId_category_idx" ON "Expense"("workspaceId", "category");
CREATE INDEX "Expense_workspaceId_productId_idx" ON "Expense"("workspaceId", "productId");
CREATE UNIQUE INDEX "Expense_workspaceId_sourceRowHash_key" ON "Expense"("workspaceId", "sourceRowHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "CustomExpenseCategory_workspaceId_name_key" ON "CustomExpenseCategory"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "RecurringExpense_workspaceId_idx" ON "RecurringExpense"("workspaceId");

