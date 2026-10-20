-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "branchLimitOverride" INTEGER,
ADD COLUMN     "extraFeatures" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "planChangedAt" TIMESTAMPTZ(3),
ADD COLUMN     "planId" UUID,
ADD COLUMN     "removedFeatures" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "staffLimitOverride" INTEGER;

-- CreateTable
CREATE TABLE "Plan" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMonthlyMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'PKR',
    "maxStaff" INTEGER,
    "maxBranches" INTEGER,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");

-- CreateIndex
CREATE INDEX "Tenant_planId_idx" ON "Tenant"("planId");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Limits are positive when set; unlimited is NULL.
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_limits_positive" CHECK (("maxStaff" IS NULL OR "maxStaff" >= 1) AND ("maxBranches" IS NULL OR "maxBranches" >= 1) AND "priceMonthlyMinor" >= 0);
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_limit_overrides_positive" CHECK (("staffLimitOverride" IS NULL OR "staffLimitOverride" >= 1) AND ("branchLimitOverride" IS NULL OR "branchLimitOverride" >= 1));
