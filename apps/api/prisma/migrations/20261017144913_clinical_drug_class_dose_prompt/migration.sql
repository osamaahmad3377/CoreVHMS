-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "rxConfirmUnitsPerDose" INTEGER NOT NULL DEFAULT 4;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "drugClass" TEXT;
