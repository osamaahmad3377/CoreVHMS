-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "pausedReason" TEXT,
ADD COLUMN     "trialEndsAt" TIMESTAMPTZ(3),
ADD COLUMN     "trialThenPlanId" UUID;
