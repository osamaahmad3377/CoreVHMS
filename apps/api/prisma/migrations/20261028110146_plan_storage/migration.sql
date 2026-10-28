-- AlterEnum
ALTER TYPE "PlanRequestKind" ADD VALUE 'EXTRA_STORAGE';

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "extraStorageMinor" INTEGER,
ADD COLUMN     "storageGb" INTEGER;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "storageLimitOverrideGb" INTEGER;

-- The recommended plans get their file storage (10 / 50 / 200 GB, extra 50 GB for Rs 1,000 a month).
-- Other plans stay without a storage limit until the super admin sets one.
UPDATE "Plan" SET "storageGb" = 10, "extraStorageMinor" = 100000 WHERE "name" = 'Starter' AND "currency" = 'PKR';
UPDATE "Plan" SET "storageGb" = 50, "extraStorageMinor" = 100000 WHERE "name" = 'Professional' AND "currency" = 'PKR';
UPDATE "Plan" SET "storageGb" = 200, "extraStorageMinor" = 100000 WHERE "name" = 'Premium' AND "currency" = 'PKR';
