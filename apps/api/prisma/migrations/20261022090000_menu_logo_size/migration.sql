CREATE TYPE "MenuLogoSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');
ALTER TABLE "Organization" ADD COLUMN "menuLogoSize" "MenuLogoSize" NOT NULL DEFAULT 'MEDIUM';
