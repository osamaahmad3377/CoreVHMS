-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('OPEN', 'ORDERED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "reason" TEXT,
    "neededBy" DATE,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'OPEN',
    "requestedById" UUID NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "purchaseOrderId" UUID,
    "decidedById" UUID,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierReturn" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "supplierId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "totalMinor" INTEGER NOT NULL,
    "createdById" UUID NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierReturnLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "supplierReturnId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitCostMinor" INTEGER NOT NULL,
    "totalMinor" INTEGER NOT NULL,

    CONSTRAINT "SupplierReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseRequest_organizationId_status_idx" ON "PurchaseRequest"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_organizationId_number_key" ON "PurchaseRequest"("organizationId", "number");

-- CreateIndex
CREATE INDEX "SupplierReturn_organizationId_supplierId_idx" ON "SupplierReturn"("organizationId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierReturn_organizationId_number_key" ON "SupplierReturn"("organizationId", "number");

-- CreateIndex
CREATE INDEX "SupplierReturnLine_supplierReturnId_idx" ON "SupplierReturnLine"("supplierReturnId");

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturnLine" ADD CONSTRAINT "SupplierReturnLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturnLine" ADD CONSTRAINT "SupplierReturnLine_supplierReturnId_fkey" FOREIGN KEY ("supplierReturnId") REFERENCES "SupplierReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturnLine" ADD CONSTRAINT "SupplierReturnLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturnLine" ADD CONSTRAINT "SupplierReturnLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT purchase_request_quantity_positive CHECK (quantity > 0);
ALTER TABLE "SupplierReturnLine" ADD CONSTRAINT supplier_return_line_quantity_positive CHECK (quantity > 0);
ALTER TABLE "SupplierReturnLine" ADD CONSTRAINT supplier_return_line_cost_nonnegative CHECK ("unitCostMinor" >= 0 AND "totalMinor" >= 0);
ALTER TABLE "SupplierReturn" ADD CONSTRAINT supplier_return_total_nonnegative CHECK ("totalMinor" >= 0);
-- A return is a completed stock and accounts movement: never edited or deleted (correct with a new receipt).
CREATE TRIGGER supplier_return_append_only BEFORE UPDATE OR DELETE ON "SupplierReturn" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER supplier_return_line_append_only BEFORE UPDATE OR DELETE ON "SupplierReturnLine" FOR EACH ROW EXECUTE FUNCTION append_only();

-- New permission for asking for items to be ordered, granted to the existing system roles that use stock.
INSERT INTO "RolePermission" ("roleId", "permission")
SELECT r.id, 'procurement.request' FROM "Role" r
WHERE r."isSystem" AND r."key" IN ('owner', 'practice_manager', 'veterinarian', 'nurse', 'pharmacy', 'surgeon', 'ward_staff', 'inventory_officer', 'field_vet')
ON CONFLICT DO NOTHING;
