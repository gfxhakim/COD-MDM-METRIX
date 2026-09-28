-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "fxRate" REAL;
ALTER TABLE "Expense" ADD COLUMN "originalAmount" INTEGER;
ALTER TABLE "Expense" ADD COLUMN "originalCurrency" TEXT;

-- AlterTable
ALTER TABLE "ProductCostVersion" ADD COLUMN "sourcingCostOriginal" INTEGER;
ALTER TABLE "ProductCostVersion" ADD COLUMN "sourcingCurrency" TEXT;
ALTER TABLE "ProductCostVersion" ADD COLUMN "sourcingFxRate" REAL;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "exchangeRates" JSONB;
