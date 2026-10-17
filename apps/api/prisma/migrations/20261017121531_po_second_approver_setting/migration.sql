-- AlterTable
-- Existing clinics keep the current rule (a second person approves purchase orders): backfill true,
-- then default new clinics to false.
ALTER TABLE "Organization" ADD COLUMN     "poRequiresSecondApprover" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Organization" ALTER COLUMN "poRequiresSecondApprover" SET DEFAULT false;
