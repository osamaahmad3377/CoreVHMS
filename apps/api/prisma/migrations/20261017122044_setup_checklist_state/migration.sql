-- Setup checklist state per organization: skipped steps, hidden-at and when the optional modules were first chosen.
-- Additive only. Optional modules themselves use the existing "disabledModules" column (empty = everything on).
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "modulesChosenAt" TIMESTAMPTZ(3),
ADD COLUMN     "setupHiddenAt" TIMESTAMPTZ(3),
ADD COLUMN     "setupSkipped" TEXT[] DEFAULT ARRAY[]::TEXT[];
