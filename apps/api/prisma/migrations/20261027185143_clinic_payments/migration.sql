-- CreateEnum
CREATE TYPE "PlatformPaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'JAZZCASH', 'EASYPAISA', 'CARD', 'CHEQUE', 'OTHER');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "paidUntil" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "ClinicPayment" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "planName" TEXT,
    "billingCycle" "BillingCycle" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paidMonths" INTEGER NOT NULL,
    "freeMonths" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "paidAt" TIMESTAMPTZ(3) NOT NULL,
    "method" "PlatformPaymentMethod" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "recordedById" UUID,
    "recordedByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedByName" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "ClinicPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicPayment_number_key" ON "ClinicPayment"("number");

-- CreateIndex
CREATE INDEX "ClinicPayment_tenantId_paidAt_idx" ON "ClinicPayment"("tenantId", "paidAt");

-- CreateIndex
CREATE INDEX "ClinicPayment_paidAt_idx" ON "ClinicPayment"("paidAt");

-- AddForeignKey
ALTER TABLE "ClinicPayment" ADD CONSTRAINT "ClinicPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
