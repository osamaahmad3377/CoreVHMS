-- CreateEnum
CREATE TYPE "DisposalReason" AS ENUM ('EXPIRED', 'SHORT_DATED', 'DAMAGED', 'RECALLED', 'CONTAMINATED', 'OPENED', 'OTHER');

-- CreateEnum
CREATE TYPE "DisposalMethod" AS ENUM ('WASTE_CONTRACTOR', 'INCINERATION', 'DENATURED', 'CLINICAL_WASTE', 'RETURNED_FOR_DESTRUCTION', 'OTHER');

-- CreateTable
CREATE TABLE "StockDisposal" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "locationId" UUID NOT NULL,
    "reason" "DisposalReason" NOT NULL,
    "method" "DisposalMethod" NOT NULL,
    "contractor" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "witnessId" UUID,
    "witnessName" TEXT,
    "hasControlled" BOOLEAN NOT NULL DEFAULT false,
    "totalMinor" INTEGER NOT NULL,
    "disposedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockDisposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockDisposalLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "disposalId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitCostMinor" INTEGER NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "wasExpired" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StockDisposalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockDisposal_organizationId_disposedAt_idx" ON "StockDisposal"("organizationId", "disposedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockDisposal_organizationId_number_key" ON "StockDisposal"("organizationId", "number");

-- CreateIndex
CREATE INDEX "StockDisposalLine_disposalId_idx" ON "StockDisposalLine"("disposalId");

-- AddForeignKey
ALTER TABLE "StockDisposal" ADD CONSTRAINT "StockDisposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDisposal" ADD CONSTRAINT "StockDisposal_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDisposalLine" ADD CONSTRAINT "StockDisposalLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDisposalLine" ADD CONSTRAINT "StockDisposalLine_disposalId_fkey" FOREIGN KEY ("disposalId") REFERENCES "StockDisposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDisposalLine" ADD CONSTRAINT "StockDisposalLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDisposalLine" ADD CONSTRAINT "StockDisposalLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Disposal records are permanent: no changes, no deletions (corrections are new stock movements).
ALTER TABLE "StockDisposal" ADD CONSTRAINT "StockDisposal_total" CHECK ("totalMinor" >= 0);
ALTER TABLE "StockDisposal" ADD CONSTRAINT "StockDisposal_witness_for_controlled" CHECK (NOT "hasControlled" OR "witnessId" IS NOT NULL);
ALTER TABLE "StockDisposalLine" ADD CONSTRAINT "StockDisposalLine_amounts" CHECK ("quantity" > 0 AND "unitCostMinor" >= 0 AND "totalMinor" >= 0);
CREATE TRIGGER stock_disposal_append_only BEFORE UPDATE OR DELETE ON "StockDisposal" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER stock_disposal_line_append_only BEFORE UPDATE OR DELETE ON "StockDisposalLine" FOR EACH ROW EXECUTE FUNCTION append_only();
