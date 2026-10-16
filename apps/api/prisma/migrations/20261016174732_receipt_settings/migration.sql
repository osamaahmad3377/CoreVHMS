-- CreateEnum
CREATE TYPE "ReceiptLogoSource" AS ENUM ('BRANDING', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReceiptAlign" AS ENUM ('LEFT', 'CENTER', 'RIGHT');

-- CreateEnum
CREATE TYPE "ReceiptFontSize" AS ENUM ('SMALL', 'NORMAL', 'LARGE');

-- CreateTable
CREATE TABLE "ReceiptSettings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "paperWidthMm" INTEGER NOT NULL DEFAULT 80,
    "sideMarginMm" INTEGER NOT NULL DEFAULT 3,
    "fontSize" "ReceiptFontSize" NOT NULL DEFAULT 'NORMAL',
    "showLogo" BOOLEAN NOT NULL DEFAULT true,
    "logoSource" "ReceiptLogoSource" NOT NULL DEFAULT 'BRANDING',
    "customLogoAttachmentId" UUID,
    "logoWidthPercent" INTEGER NOT NULL DEFAULT 55,
    "logoAlign" "ReceiptAlign" NOT NULL DEFAULT 'CENTER',
    "logoMonochrome" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT NOT NULL DEFAULT 'TAX INVOICE / RECEIPT',
    "headerText" TEXT,
    "footerText" TEXT DEFAULT 'Thank you for caring for your pet with us',
    "policyText" TEXT,
    "showLegalName" BOOLEAN NOT NULL DEFAULT true,
    "showBranchAddress" BOOLEAN NOT NULL DEFAULT true,
    "showPhone" BOOLEAN NOT NULL DEFAULT true,
    "showEmail" BOOLEAN NOT NULL DEFAULT false,
    "showTaxNumber" BOOLEAN NOT NULL DEFAULT true,
    "showServedBy" BOOLEAN NOT NULL DEFAULT true,
    "showCustomer" BOOLEAN NOT NULL DEFAULT true,
    "showPatient" BOOLEAN NOT NULL DEFAULT true,
    "showItemCodes" BOOLEAN NOT NULL DEFAULT false,
    "showTaxLine" BOOLEAN NOT NULL DEFAULT true,
    "autoPrint" BOOLEAN NOT NULL DEFAULT false,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedByName" TEXT,

    CONSTRAINT "ReceiptSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptSettings_organizationId_key" ON "ReceiptSettings"("organizationId");

-- AddForeignKey
ALTER TABLE "ReceiptSettings" ADD CONSTRAINT "ReceiptSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReceiptSettings" ADD CONSTRAINT receipt_paper_width CHECK ("paperWidthMm" IN (58, 80));
ALTER TABLE "ReceiptSettings" ADD CONSTRAINT receipt_side_margin CHECK ("sideMarginMm" BETWEEN 0 AND 8);
ALTER TABLE "ReceiptSettings" ADD CONSTRAINT receipt_logo_width CHECK ("logoWidthPercent" BETWEEN 15 AND 100);
ALTER TABLE "ReceiptSettings" ADD CONSTRAINT receipt_copies CHECK (copies BETWEEN 1 AND 3);
