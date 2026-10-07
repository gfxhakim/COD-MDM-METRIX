-- CreateTable
CREATE TABLE "MdmAccount" (
    "workspaceId" TEXT NOT NULL,
    "sellerId" TEXT,
    "wallet" JSONB,
    "walletAt" TIMESTAMP(3),
    "prices" JSONB,
    "pricesAt" TIMESTAMP(3),
    "capital" JSONB,
    "capitalAt" TIMESTAMP(3),
    "feesSyncedAt" TIMESTAMP(3),
    "payoutsSyncedAt" TIMESTAMP(3),
    "parts" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MdmAccount_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "MdmPayout" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "status" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "storeNames" TEXT,
    "breakdown" JSONB,
    "breakdownAt" TIMESTAMP(3),
    "mdmCreatedAt" TIMESTAMP(3) NOT NULL,
    "mdmUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MdmPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MdmFee" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "entityId" TEXT,
    "type" TEXT NOT NULL,
    "subType" TEXT,
    "amount" INTEGER NOT NULL,
    "grossAmount" INTEGER,
    "taxes" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "status" TEXT NOT NULL,
    "payoutId" TEXT,
    "parcelId" TEXT,
    "orderId" TEXT,
    "mdmCreatedAt" TIMESTAMP(3) NOT NULL,
    "mdmUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MdmFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MdmStockItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "mdmProductId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantName" TEXT,
    "sku" TEXT,
    "sellingPrice" INTEGER,
    "purchasePrice" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "totalInbound" INTEGER NOT NULL DEFAULT 0,
    "incoming" INTEGER NOT NULL DEFAULT 0,
    "available" INTEGER NOT NULL DEFAULT 0,
    "processing" INTEGER NOT NULL DEFAULT 0,
    "inDelivery" INTEGER NOT NULL DEFAULT 0,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "returning" INTEGER NOT NULL DEFAULT 0,
    "returned" INTEGER NOT NULL DEFAULT 0,
    "damaged" INTEGER NOT NULL DEFAULT 0,
    "discharged" INTEGER NOT NULL DEFAULT 0,
    "lost" INTEGER NOT NULL DEFAULT 0,
    "stockAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MdmStockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MdmStockArrival" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "operation" TEXT,
    "products" JSONB NOT NULL,
    "expectedUnits" INTEGER NOT NULL DEFAULT 0,
    "receivedUnits" INTEGER NOT NULL DEFAULT 0,
    "damagedUnits" INTEGER NOT NULL DEFAULT 0,
    "mdmCreatedAt" TIMESTAMP(3) NOT NULL,
    "mdmUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MdmStockArrival_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MdmPayout_workspaceId_mdmCreatedAt_idx" ON "MdmPayout"("workspaceId", "mdmCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MdmPayout_workspaceId_providerId_key" ON "MdmPayout"("workspaceId", "providerId");

-- CreateIndex
CREATE INDEX "MdmFee_workspaceId_mdmCreatedAt_idx" ON "MdmFee"("workspaceId", "mdmCreatedAt");

-- CreateIndex
CREATE INDEX "MdmFee_workspaceId_type_idx" ON "MdmFee"("workspaceId", "type");

-- CreateIndex
CREATE INDEX "MdmFee_workspaceId_payoutId_idx" ON "MdmFee"("workspaceId", "payoutId");

-- CreateIndex
CREATE INDEX "MdmFee_parcelId_idx" ON "MdmFee"("parcelId");

-- CreateIndex
CREATE INDEX "MdmFee_orderId_idx" ON "MdmFee"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "MdmFee_workspaceId_providerId_key" ON "MdmFee"("workspaceId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "MdmStockItem_workspaceId_providerId_key" ON "MdmStockItem"("workspaceId", "providerId");

-- CreateIndex
CREATE INDEX "MdmStockArrival_workspaceId_mdmCreatedAt_idx" ON "MdmStockArrival"("workspaceId", "mdmCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MdmStockArrival_workspaceId_providerId_key" ON "MdmStockArrival"("workspaceId", "providerId");

-- AddForeignKey
ALTER TABLE "MdmAccount" ADD CONSTRAINT "MdmAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MdmPayout" ADD CONSTRAINT "MdmPayout_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MdmFee" ADD CONSTRAINT "MdmFee_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MdmFee" ADD CONSTRAINT "MdmFee_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MdmFee" ADD CONSTRAINT "MdmFee_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MdmStockItem" ADD CONSTRAINT "MdmStockItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MdmStockArrival" ADD CONSTRAINT "MdmStockArrival_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

