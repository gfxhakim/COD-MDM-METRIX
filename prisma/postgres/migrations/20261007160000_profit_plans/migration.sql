-- CreateTable
CREATE TABLE "ProfitPlan" (
    "productId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "stockSource" TEXT NOT NULL DEFAULT 'MDM_AVAILABLE',
    "stockUnits" INTEGER,
    "overrides" JSONB,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfitPlan_pkey" PRIMARY KEY ("productId")
);

-- CreateIndex
CREATE INDEX "ProfitPlan_workspaceId_idx" ON "ProfitPlan"("workspaceId");

-- AddForeignKey
ALTER TABLE "ProfitPlan" ADD CONSTRAINT "ProfitPlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitPlan" ADD CONSTRAINT "ProfitPlan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

