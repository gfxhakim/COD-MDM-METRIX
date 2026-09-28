-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "fxRate" DOUBLE PRECISION,
ADD COLUMN     "originalAmount" INTEGER,
ADD COLUMN     "originalCurrency" TEXT;

-- AlterTable
ALTER TABLE "ProductCostVersion" ADD COLUMN     "sourcingCostOriginal" INTEGER,
ADD COLUMN     "sourcingCurrency" TEXT,
ADD COLUMN     "sourcingFxRate" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "exchangeRates" JSONB;

