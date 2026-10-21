-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "returnedMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnedQuantity" DECIMAL(14,4) NOT NULL DEFAULT 0;
