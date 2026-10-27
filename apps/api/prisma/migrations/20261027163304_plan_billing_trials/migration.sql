-- CreateEnum
CREATE TYPE "PlanRequestKind" AS ENUM ('PLAN', 'EXTRA_BRANCH', 'EXTRA_STAFF');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "recipeKey" TEXT;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "extraBranchMinor" INTEGER,
ADD COLUMN     "extraStaffMinor" INTEGER,
ADD COLUMN     "maxCustomAutomations" INTEGER,
ADD COLUMN     "phoneSupport" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priceYearlyMinor" INTEGER,
ADD COLUMN     "supportResponse" TEXT,
ADD COLUMN     "trainingSessions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trialDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "whatsappSupport" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PlanRequest" ADD COLUMN     "kind" "PlanRequestKind" NOT NULL DEFAULT 'PLAN',
ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "toPlanId" DROP NOT NULL;
