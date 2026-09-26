-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'ANALYST', 'OPERATOR');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('MDM_EXPRESS');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('NOT_CONFIGURED', 'UNTESTED', 'CONNECTED', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'RETRY');

-- CreateEnum
CREATE TYPE "SyncItemResult" AS ENUM ('ADDED', 'UPDATED', 'UNCHANGED', 'FAILED', 'UNMATCHED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "NormalizedStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED', 'LOST', 'CANCELED', 'EXCHANGED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('SHOPIFY', 'EASYSELL', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELED');

-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('ORDER_REFERENCE', 'TRACKING_ID', 'SOURCE_ORDER_ID', 'MANUAL', 'NONE');

-- CreateEnum
CREATE TYPE "AttributionMethod" AS ENUM ('UTM_CONTENT', 'MANUAL', 'NONE');

-- CreateEnum
CREATE TYPE "AdPlatform" AS ENUM ('META', 'TIKTOK', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('AI_TOOLS', 'SOFTWARE', 'OFFICE', 'DOMAINS_PROXIES', 'BANK_FEES', 'CALL_CENTER', 'PACKAGING', 'WAREHOUSE', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseAllocation" AS ENUM ('GLOBAL', 'PRODUCT');

-- CreateEnum
CREATE TYPE "CostType" AS ENUM ('FIXED', 'VARIABLE');

-- CreateEnum
CREATE TYPE "BankReviewStatus" AS ENUM ('PENDING', 'CATEGORIZED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('ORDERS', 'AD_SPEND', 'EXPENSES', 'BANK');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEW', 'COMMITTED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "CashEventType" AS ENUM ('COD_COLLECTED', 'REMITTED', 'CARRIER_FEE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Algiers',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "economicsDefaults" JSONB,
    "verdictThresholds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "baseUrl" TEXT NOT NULL DEFAULT 'https://api.mdm.express',
    "encryptedCredential" TEXT,
    "keyVersion" INTEGER,
    "maskedLabel" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "lastTestedAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 45,
    "credentialUpdatedAt" TIMESTAMP(3),
    "credentialUpdatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger" "SyncTrigger" NOT NULL DEFAULT 'MANUAL',
    "requestedById" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "cursor" TEXT,
    "page" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER,
    "addedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "unknownStatusCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "mode" TEXT NOT NULL DEFAULT 'INCREMENTAL',
    "adapter" TEXT NOT NULL DEFAULT 'mock',
    "updatedSince" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "retryOfJobId" TEXT,
    "activeLock" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "localId" TEXT,
    "result" "SyncItemResult" NOT NULL,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawExternalRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "entityType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawExternalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusMapping" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "providerStatus" TEXT NOT NULL,
    "normalizedStatus" "NormalizedStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatusMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnmatchedRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "entityType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "reference" TEXT,
    "reason" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'OPEN',
    "parcelId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnmatchedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCostVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "salePrice" INTEGER NOT NULL,
    "sourcingCost" INTEGER NOT NULL,
    "forwardShippingFee" INTEGER NOT NULL,
    "rtoFee" INTEGER NOT NULL,
    "callCenterFee" INTEGER NOT NULL,
    "packagingFee" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCostVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "source" "OrderSource" NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "normalizedOrderNumber" TEXT NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "callAttempts" INTEGER,
    "phoneHash" TEXT,
    "phoneMasked" TEXT,
    "customerRef" TEXT,
    "wilaya" TEXT,
    "city" TEXT,
    "codAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "tags" TEXT,
    "notes" TEXT,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "sku" TEXT,
    "productName" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attribution" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "creativeId" TEXT,
    "orderPlacedAt" TIMESTAMP(3) NOT NULL,
    "rawUtmContent" TEXT,
    "normalizedCreativeKey" TEXT,
    "method" "AttributionMethod" NOT NULL DEFAULT 'NONE',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parcel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "orderId" TEXT,
    "provider" "IntegrationProvider" NOT NULL,
    "trackingId" TEXT NOT NULL,
    "providerReference" TEXT,
    "sourceOrderId" TEXT,
    "providerStatus" TEXT,
    "normalizedStatus" "NormalizedStatus" NOT NULL DEFAULT 'UNKNOWN',
    "codAmount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "shippingFee" INTEGER,
    "returnFee" INTEGER,
    "wilaya" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "lastProviderUpdateAt" TIMESTAMP(3),
    "matchMethod" "MatchMethod" NOT NULL DEFAULT 'NONE',
    "matchConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isDemoFixture" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Parcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelStatusEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "providerStatus" TEXT NOT NULL,
    "normalizedStatus" "NormalizedStatus" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MDM_EXPRESS',
    "eventHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParcelStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "CashEventType" NOT NULL,
    "parcelId" TEXT,
    "orderId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "externalRef" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creative" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" "AdPlatform" NOT NULL DEFAULT 'META',
    "externalCreativeId" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "name" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "adsetName" TEXT,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdSpend" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" "AdPlatform" NOT NULL DEFAULT 'META',
    "source" TEXT NOT NULL DEFAULT 'META_CSV',
    "date" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "adsetId" TEXT,
    "adsetName" TEXT,
    "adId" TEXT,
    "adName" TEXT,
    "externalCreativeId" TEXT,
    "creativeId" TEXT,
    "spend" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "originalSpend" INTEGER,
    "originalCurrency" TEXT,
    "fxRate" DOUBLE PRECISION,
    "impressions" INTEGER,
    "clicks" INTEGER,
    "sourceRowHash" TEXT NOT NULL,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdSpend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "description" TEXT,
    "allocation" "ExpenseAllocation" NOT NULL DEFAULT 'GLOBAL',
    "productId" TEXT,
    "costType" "CostType" NOT NULL DEFAULT 'FIXED',
    "bankTransactionId" TEXT,
    "importBatchId" TEXT,
    "sourceRowHash" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "reference" TEXT,
    "rowHash" TEXT NOT NULL,
    "reviewStatus" "BankReviewStatus" NOT NULL DEFAULT 'PENDING',
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEW',
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRowError" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "field" TEXT,
    "message" TEXT NOT NULL,
    "rawRow" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRowError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulatorScenario" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulatorScenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_action_idx" ON "AuditLog"("workspaceId", "action");

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_workspaceId_provider_key" ON "IntegrationConnection"("workspaceId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "SyncJob_activeLock_key" ON "SyncJob"("activeLock");

-- CreateIndex
CREATE INDEX "SyncJob_workspaceId_status_idx" ON "SyncJob"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "SyncJob_workspaceId_createdAt_idx" ON "SyncJob"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "SyncJob_status_nextRunAt_idx" ON "SyncJob"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "SyncItem_workspaceId_result_idx" ON "SyncItem"("workspaceId", "result");

-- CreateIndex
CREATE INDEX "SyncItem_jobId_idx" ON "SyncItem"("jobId");

-- CreateIndex
CREATE INDEX "RawExternalRecord_workspaceId_provider_externalId_idx" ON "RawExternalRecord"("workspaceId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "RawExternalRecord_observedAt_idx" ON "RawExternalRecord"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RawExternalRecord_workspaceId_provider_entityType_externalI_key" ON "RawExternalRecord"("workspaceId", "provider", "entityType", "externalId", "payloadHash");

-- CreateIndex
CREATE UNIQUE INDEX "StatusMapping_workspaceId_provider_providerStatus_key" ON "StatusMapping"("workspaceId", "provider", "providerStatus");

-- CreateIndex
CREATE INDEX "UnmatchedRecord_workspaceId_status_idx" ON "UnmatchedRecord"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UnmatchedRecord_workspaceId_provider_entityType_externalId_key" ON "UnmatchedRecord"("workspaceId", "provider", "entityType", "externalId");

-- CreateIndex
CREATE INDEX "Product_workspaceId_active_idx" ON "Product"("workspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Product_workspaceId_sku_key" ON "Product"("workspaceId", "sku");

-- CreateIndex
CREATE INDEX "ProductCostVersion_workspaceId_productId_effectiveFrom_idx" ON "ProductCostVersion"("workspaceId", "productId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ProductCostVersion_effectiveFrom_idx" ON "ProductCostVersion"("effectiveFrom");

-- CreateIndex
CREATE INDEX "Order_workspaceId_normalizedOrderNumber_idx" ON "Order"("workspaceId", "normalizedOrderNumber");

-- CreateIndex
CREATE INDEX "Order_workspaceId_placedAt_idx" ON "Order"("workspaceId", "placedAt");

-- CreateIndex
CREATE INDEX "Order_workspaceId_status_idx" ON "Order"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Order_workspaceId_wilaya_idx" ON "Order"("workspaceId", "wilaya");

-- CreateIndex
CREATE INDEX "Order_confirmedAt_idx" ON "Order"("confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_workspaceId_source_externalOrderId_key" ON "Order"("workspaceId", "source", "externalOrderId");

-- CreateIndex
CREATE INDEX "OrderLine_workspaceId_productId_idx" ON "OrderLine"("workspaceId", "productId");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Attribution_orderId_key" ON "Attribution"("orderId");

-- CreateIndex
CREATE INDEX "Attribution_workspaceId_creativeId_orderPlacedAt_idx" ON "Attribution"("workspaceId", "creativeId", "orderPlacedAt");

-- CreateIndex
CREATE INDEX "Parcel_workspaceId_normalizedStatus_idx" ON "Parcel"("workspaceId", "normalizedStatus");

-- CreateIndex
CREATE INDEX "Parcel_workspaceId_wilaya_idx" ON "Parcel"("workspaceId", "wilaya");

-- CreateIndex
CREATE INDEX "Parcel_workspaceId_orderId_idx" ON "Parcel"("workspaceId", "orderId");

-- CreateIndex
CREATE INDEX "Parcel_dispatchedAt_idx" ON "Parcel"("dispatchedAt");

-- CreateIndex
CREATE INDEX "Parcel_deliveredAt_idx" ON "Parcel"("deliveredAt");

-- CreateIndex
CREATE INDEX "Parcel_returnedAt_idx" ON "Parcel"("returnedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Parcel_workspaceId_provider_trackingId_key" ON "Parcel"("workspaceId", "provider", "trackingId");

-- CreateIndex
CREATE INDEX "ParcelStatusEvent_workspaceId_occurredAt_idx" ON "ParcelStatusEvent"("workspaceId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ParcelStatusEvent_parcelId_eventHash_key" ON "ParcelStatusEvent"("parcelId", "eventHash");

-- CreateIndex
CREATE INDEX "CashEvent_workspaceId_occurredAt_idx" ON "CashEvent"("workspaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "CashEvent_workspaceId_type_idx" ON "CashEvent"("workspaceId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CashEvent_workspaceId_externalRef_key" ON "CashEvent"("workspaceId", "externalRef");

-- CreateIndex
CREATE INDEX "Creative_workspaceId_normalizedKey_idx" ON "Creative"("workspaceId", "normalizedKey");

-- CreateIndex
CREATE UNIQUE INDEX "Creative_workspaceId_platform_externalCreativeId_key" ON "Creative"("workspaceId", "platform", "externalCreativeId");

-- CreateIndex
CREATE INDEX "AdSpend_workspaceId_date_idx" ON "AdSpend"("workspaceId", "date");

-- CreateIndex
CREATE INDEX "AdSpend_workspaceId_creativeId_date_idx" ON "AdSpend"("workspaceId", "creativeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdSpend_workspaceId_source_sourceRowHash_key" ON "AdSpend"("workspaceId", "source", "sourceRowHash");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_bankTransactionId_key" ON "Expense"("bankTransactionId");

-- CreateIndex
CREATE INDEX "Expense_workspaceId_date_idx" ON "Expense"("workspaceId", "date");

-- CreateIndex
CREATE INDEX "Expense_workspaceId_category_idx" ON "Expense"("workspaceId", "category");

-- CreateIndex
CREATE INDEX "Expense_workspaceId_productId_idx" ON "Expense"("workspaceId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_workspaceId_sourceRowHash_key" ON "Expense"("workspaceId", "sourceRowHash");

-- CreateIndex
CREATE INDEX "BankTransaction_workspaceId_date_idx" ON "BankTransaction"("workspaceId", "date");

-- CreateIndex
CREATE INDEX "BankTransaction_workspaceId_reviewStatus_idx" ON "BankTransaction"("workspaceId", "reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_workspaceId_rowHash_key" ON "BankTransaction"("workspaceId", "rowHash");

-- CreateIndex
CREATE INDEX "ImportBatch_workspaceId_kind_createdAt_idx" ON "ImportBatch"("workspaceId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ImportRowError_batchId_idx" ON "ImportRowError"("batchId");

-- CreateIndex
CREATE INDEX "ImportRowError_workspaceId_createdAt_idx" ON "ImportRowError"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "MetricSnapshot_periodStart_idx" ON "MetricSnapshot"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "MetricSnapshot_workspaceId_kind_periodStart_periodEnd_key" ON "MetricSnapshot"("workspaceId", "kind", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "SimulatorScenario_workspaceId_createdAt_idx" ON "SimulatorScenario"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncItem" ADD CONSTRAINT "SyncItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncItem" ADD CONSTRAINT "SyncItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawExternalRecord" ADD CONSTRAINT "RawExternalRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusMapping" ADD CONSTRAINT "StatusMapping_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnmatchedRecord" ADD CONSTRAINT "UnmatchedRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnmatchedRecord" ADD CONSTRAINT "UnmatchedRecord_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCostVersion" ADD CONSTRAINT "ProductCostVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCostVersion" ADD CONSTRAINT "ProductCostVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attribution" ADD CONSTRAINT "Attribution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attribution" ADD CONSTRAINT "Attribution_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attribution" ADD CONSTRAINT "Attribution_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Creative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Parcel" ADD CONSTRAINT "Parcel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Parcel" ADD CONSTRAINT "Parcel_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelStatusEvent" ADD CONSTRAINT "ParcelStatusEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelStatusEvent" ADD CONSTRAINT "ParcelStatusEvent_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashEvent" ADD CONSTRAINT "CashEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashEvent" ADD CONSTRAINT "CashEvent_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashEvent" ADD CONSTRAINT "CashEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creative" ADD CONSTRAINT "Creative_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creative" ADD CONSTRAINT "Creative_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSpend" ADD CONSTRAINT "AdSpend_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSpend" ADD CONSTRAINT "AdSpend_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Creative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSpend" ADD CONSTRAINT "AdSpend_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRowError" ADD CONSTRAINT "ImportRowError_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRowError" ADD CONSTRAINT "ImportRowError_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulatorScenario" ADD CONSTRAINT "SimulatorScenario_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulatorScenario" ADD CONSTRAINT "SimulatorScenario_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

