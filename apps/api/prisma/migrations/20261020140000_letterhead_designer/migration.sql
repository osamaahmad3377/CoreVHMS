-- CreateEnum
CREATE TYPE "PrintSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');

-- CreateEnum
CREATE TYPE "PrintRule" AS ENUM ('BAND', 'LINE', 'DOUBLE', 'NONE');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "printLogoSize" "PrintSize" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "printNameSize" "PrintSize" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "printRule" "PrintRule" NOT NULL DEFAULT 'BAND',
ADD COLUMN     "printShowAddress" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "printShowContact" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "printShowTaxNumber" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "printFooterAlign" "PrintLogoPosition" NOT NULL DEFAULT 'CENTER',
ADD COLUMN     "printPreprinted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "printTopSpaceMm" INTEGER NOT NULL DEFAULT 40;
