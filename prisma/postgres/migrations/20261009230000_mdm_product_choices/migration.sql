-- AlterTable
ALTER TABLE "IntegrationConnection" ADD COLUMN     "bringNewMdmProducts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "choicesWidenedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MdmProductChoice" (
    "workspaceId" TEXT NOT NULL,
    "mdmProductId" TEXT NOT NULL,
    "name" TEXT,
    "bring" BOOLEAN NOT NULL DEFAULT true,
    "since" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MdmProductChoice_pkey" PRIMARY KEY ("workspaceId","mdmProductId")
);

-- CreateTable
CREATE TABLE "MdmSkippedOrder" (
    "workspaceId" TEXT NOT NULL,
    "mdmOrderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MdmSkippedOrder_pkey" PRIMARY KEY ("workspaceId","mdmOrderId")
);

-- AddForeignKey
ALTER TABLE "MdmProductChoice" ADD CONSTRAINT "MdmProductChoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MdmSkippedOrder" ADD CONSTRAINT "MdmSkippedOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

