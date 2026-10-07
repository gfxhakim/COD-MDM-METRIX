-- CreateEnum
CREATE TYPE "ExpenseFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExpenseCategory" ADD VALUE 'SALARIES';
ALTER TYPE "ExpenseCategory" ADD VALUE 'OTHER_ADS';
ALTER TYPE "ExpenseCategory" ADD VALUE 'CONTENT';
ALTER TYPE "ExpenseCategory" ADD VALUE 'TRANSPORT';
ALTER TYPE "ExpenseCategory" ADD VALUE 'TAXES';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "customCategoryId" TEXT;

-- CreateTable
CREATE TABLE "CustomExpenseCategory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringExpense" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "customCategoryId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "originalAmount" INTEGER,
    "originalCurrency" TEXT,
    "fxRate" DOUBLE PRECISION,
    "frequency" "ExpenseFrequency" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "allocation" "ExpenseAllocation" NOT NULL DEFAULT 'GLOBAL',
    "productId" TEXT,
    "costType" "CostType" NOT NULL DEFAULT 'FIXED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomExpenseCategory_workspaceId_name_key" ON "CustomExpenseCategory"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "RecurringExpense_workspaceId_idx" ON "RecurringExpense"("workspaceId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_customCategoryId_fkey" FOREIGN KEY ("customCategoryId") REFERENCES "CustomExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomExpenseCategory" ADD CONSTRAINT "CustomExpenseCategory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_customCategoryId_fkey" FOREIGN KEY ("customCategoryId") REFERENCES "CustomExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

