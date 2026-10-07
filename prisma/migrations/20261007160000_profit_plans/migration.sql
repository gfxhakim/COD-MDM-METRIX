-- CreateTable
CREATE TABLE "ProfitPlan" (
    "productId" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "stockSource" TEXT NOT NULL DEFAULT 'MDM_AVAILABLE',
    "stockUnits" INTEGER,
    "overrides" JSONB,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProfitPlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProfitPlan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProfitPlan_workspaceId_idx" ON "ProfitPlan"("workspaceId");

