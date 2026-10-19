-- CreateEnum
CREATE TYPE "BrandFont" AS ENUM ('SYSTEM', 'INTER', 'ROBOTO', 'OPEN_SANS', 'LATO', 'POPPINS', 'NUNITO', 'MERRIWEATHER');

-- CreateEnum
CREATE TYPE "CornerStyle" AS ENUM ('SHARP', 'STANDARD', 'ROUNDED');

-- CreateEnum
CREATE TYPE "ThemeMode" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "LoginLayout" AS ENUM ('SPLIT', 'CENTERED');

-- CreateEnum
CREATE TYPE "LoginBackground" AS ENUM ('MENU_COLOUR', 'GRADIENT', 'IMAGE');

-- CreateEnum
CREATE TYPE "PrintLogoPosition" AS ENUM ('LEFT', 'CENTER', 'RIGHT');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "brandFont" "BrandFont" NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN     "cornerStyle" "CornerStyle" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "defaultTheme" "ThemeMode" NOT NULL DEFAULT 'LIGHT',
ADD COLUMN     "emailSenderName" TEXT,
ADD COLUMN     "emailSignature" TEXT,
ADD COLUMN     "loginBackground" "LoginBackground" NOT NULL DEFAULT 'MENU_COLOUR',
ADD COLUMN     "loginBackgroundAttachmentId" UUID,
ADD COLUMN     "loginFooter" TEXT,
ADD COLUMN     "loginLayout" "LoginLayout" NOT NULL DEFAULT 'SPLIT',
ADD COLUMN     "logoDarkAttachmentId" UUID,
ADD COLUMN     "printFooterText" TEXT,
ADD COLUMN     "printHeaderText" TEXT,
ADD COLUMN     "printLogoPosition" "PrintLogoPosition" NOT NULL DEFAULT 'LEFT',
ADD COLUMN     "printUseBrandColour" BOOLEAN NOT NULL DEFAULT true;

-- Length limits for owner-entered branding text (also enforced by the API).
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_branding_text_len" CHECK (
  coalesce(length("loginFooter"), 0) <= 200 AND coalesce(length("printHeaderText"), 0) <= 200 AND
  coalesce(length("printFooterText"), 0) <= 300 AND coalesce(length("emailSenderName"), 0) <= 60 AND
  coalesce(length("emailSignature"), 0) <= 500
);
