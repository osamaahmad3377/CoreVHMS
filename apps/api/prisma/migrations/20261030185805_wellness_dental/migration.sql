-- CreateEnum
CREATE TYPE "WellnessPlanStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "WellnessItemKind" AS ENUM ('SERVICE', 'PRODUCT', 'LAB');

-- CreateEnum
CREATE TYPE "WellnessBilling" AS ENUM ('UPFRONT', 'MONTHLY');

-- CreateEnum
CREATE TYPE "WellnessEnrolmentStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WellnessInstalmentStatus" AS ENUM ('SCHEDULED', 'BILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WellnessUsageKind" AS ENUM ('INCLUDED', 'DISCOUNT', 'MANUAL');

-- CreateEnum
CREATE TYPE "DentalDentition" AS ENUM ('CANINE', 'FELINE', 'EQUINE');

-- CreateEnum
CREATE TYPE "DentalChartStatus" AS ENUM ('DRAFT', 'SIGNED');

-- CreateEnum
CREATE TYPE "DentalToothState" AS ENUM ('PRESENT', 'MISSING', 'UNERUPTED', 'EXTRACTED');

-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "discountMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountNote" TEXT;

-- CreateTable
CREATE TABLE "WellnessPlan" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "speciesId" UUID,
    "durationMonths" INTEGER NOT NULL DEFAULT 12,
    "priceMinor" INTEGER NOT NULL,
    "monthlyPriceMinor" INTEGER,
    "joiningFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "taxRateId" UUID,
    "serviceDiscountBp" INTEGER NOT NULL DEFAULT 0,
    "productDiscountBp" INTEGER NOT NULL DEFAULT 0,
    "terms" TEXT,
    "status" "WellnessPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WellnessPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WellnessPlanItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "kind" "WellnessItemKind" NOT NULL,
    "serviceId" UUID,
    "productId" UUID,
    "labTestId" UUID,
    "quantity" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WellnessPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WellnessEnrolment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "planId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "planName" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "billing" "WellnessBilling" NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "joiningFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "taxRateBasisPoints" INTEGER NOT NULL DEFAULT 0,
    "serviceDiscountBp" INTEGER NOT NULL DEFAULT 0,
    "productDiscountBp" INTEGER NOT NULL DEFAULT 0,
    "terms" TEXT,
    "notes" TEXT,
    "status" "WellnessEnrolmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "renewedFromId" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "cancelledByName" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WellnessEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WellnessEntitlement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "enrolmentId" UUID NOT NULL,
    "kind" "WellnessItemKind" NOT NULL,
    "serviceId" UUID,
    "productId" UUID,
    "labTestId" UUID,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitValueMinor" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WellnessEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WellnessInstalment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "enrolmentId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" "WellnessInstalmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "billedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WellnessInstalment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WellnessUsage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "enrolmentId" UUID NOT NULL,
    "entitlementId" UUID,
    "chargeId" UUID,
    "kind" "WellnessUsageKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "savedMinor" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "recordedByName" TEXT,
    "usedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMPTZ(3),
    "reversedReason" TEXT,
    "reversedByName" TEXT,

    CONSTRAINT "WellnessUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DentalChart" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "branchId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "encounterId" UUID,
    "dentition" "DentalDentition" NOT NULL,
    "showDeciduous" BOOLEAN NOT NULL DEFAULT false,
    "examinedAt" TIMESTAMPTZ(3) NOT NULL,
    "anaesthetised" BOOLEAN NOT NULL DEFAULT false,
    "status" "DentalChartStatus" NOT NULL DEFAULT 'DRAFT',
    "occlusion" TEXT,
    "periodontalStage" INTEGER,
    "calculusIndex" INTEGER,
    "gingivalIndex" INTEGER,
    "oralFindings" TEXT,
    "homeCare" TEXT,
    "notes" TEXT,
    "recheckDate" DATE,
    "previousChartId" UUID,
    "clinicianId" UUID,
    "clinicianName" TEXT NOT NULL,
    "signedById" UUID,
    "signedByName" TEXT,
    "signedAt" TIMESTAMPTZ(3),
    "contentHash" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DentalChart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DentalToothFinding" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "chartId" UUID NOT NULL,
    "tooth" TEXT NOT NULL,
    "state" "DentalToothState" NOT NULL DEFAULT 'PRESENT',
    "findings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trStage" INTEGER,
    "pdStage" INTEGER,
    "mobility" INTEGER,
    "furcation" INTEGER,
    "calculus" INTEGER,
    "gingivitis" INTEGER,
    "probingMm" DECIMAL(4,1),
    "recessionMm" DECIMAL(4,1),
    "notes" TEXT,

    CONSTRAINT "DentalToothFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DentalProcedure" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "chartId" UUID NOT NULL,
    "tooth" TEXT,
    "code" TEXT NOT NULL,
    "serviceId" UUID,
    "notes" TEXT,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DentalProcedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DentalChartAddendum" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "chartId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "authorId" UUID NOT NULL,
    "authorName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DentalChartAddendum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DentalProcedurePrice" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "serviceId" UUID NOT NULL,

    CONSTRAINT "DentalProcedurePrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WellnessPlan_organizationId_status_idx" ON "WellnessPlan"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WellnessPlan_organizationId_name_key" ON "WellnessPlan"("organizationId", "name");

-- CreateIndex
CREATE INDEX "WellnessPlanItem_planId_idx" ON "WellnessPlanItem"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "WellnessEnrolment_renewedFromId_key" ON "WellnessEnrolment"("renewedFromId");

-- CreateIndex
CREATE INDEX "WellnessEnrolment_organizationId_status_endDate_idx" ON "WellnessEnrolment"("organizationId", "status", "endDate");

-- CreateIndex
CREATE INDEX "WellnessEnrolment_patientId_startDate_idx" ON "WellnessEnrolment"("patientId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "WellnessEnrolment_organizationId_number_key" ON "WellnessEnrolment"("organizationId", "number");

-- CreateIndex
CREATE INDEX "WellnessEntitlement_enrolmentId_idx" ON "WellnessEntitlement"("enrolmentId");

-- CreateIndex
CREATE INDEX "WellnessInstalment_organizationId_status_dueDate_idx" ON "WellnessInstalment"("organizationId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "WellnessInstalment_enrolmentId_seq_key" ON "WellnessInstalment"("enrolmentId", "seq");

-- CreateIndex
CREATE INDEX "WellnessUsage_enrolmentId_idx" ON "WellnessUsage"("enrolmentId");

-- CreateIndex
CREATE INDEX "WellnessUsage_chargeId_idx" ON "WellnessUsage"("chargeId");

-- CreateIndex
CREATE INDEX "DentalChart_patientId_examinedAt_idx" ON "DentalChart"("patientId", "examinedAt" DESC);

-- CreateIndex
CREATE INDEX "DentalChart_organizationId_status_examinedAt_idx" ON "DentalChart"("organizationId", "status", "examinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DentalChart_organizationId_number_key" ON "DentalChart"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "DentalToothFinding_chartId_tooth_key" ON "DentalToothFinding"("chartId", "tooth");

-- CreateIndex
CREATE INDEX "DentalProcedure_chartId_idx" ON "DentalProcedure"("chartId");

-- CreateIndex
CREATE INDEX "DentalChartAddendum_chartId_idx" ON "DentalChartAddendum"("chartId");

-- CreateIndex
CREATE UNIQUE INDEX "DentalProcedurePrice_organizationId_code_key" ON "DentalProcedurePrice"("organizationId", "code");

-- AddForeignKey
ALTER TABLE "WellnessPlan" ADD CONSTRAINT "WellnessPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessPlan" ADD CONSTRAINT "WellnessPlan_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "Species"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessPlanItem" ADD CONSTRAINT "WellnessPlanItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessPlanItem" ADD CONSTRAINT "WellnessPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WellnessPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessPlanItem" ADD CONSTRAINT "WellnessPlanItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessPlanItem" ADD CONSTRAINT "WellnessPlanItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessPlanItem" ADD CONSTRAINT "WellnessPlanItem_labTestId_fkey" FOREIGN KEY ("labTestId") REFERENCES "LabTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessEnrolment" ADD CONSTRAINT "WellnessEnrolment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessEnrolment" ADD CONSTRAINT "WellnessEnrolment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WellnessPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessEnrolment" ADD CONSTRAINT "WellnessEnrolment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessEnrolment" ADD CONSTRAINT "WellnessEnrolment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessEnrolment" ADD CONSTRAINT "WellnessEnrolment_renewedFromId_fkey" FOREIGN KEY ("renewedFromId") REFERENCES "WellnessEnrolment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessEntitlement" ADD CONSTRAINT "WellnessEntitlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessEntitlement" ADD CONSTRAINT "WellnessEntitlement_enrolmentId_fkey" FOREIGN KEY ("enrolmentId") REFERENCES "WellnessEnrolment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessEntitlement" ADD CONSTRAINT "WellnessEntitlement_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessEntitlement" ADD CONSTRAINT "WellnessEntitlement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessEntitlement" ADD CONSTRAINT "WellnessEntitlement_labTestId_fkey" FOREIGN KEY ("labTestId") REFERENCES "LabTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessInstalment" ADD CONSTRAINT "WellnessInstalment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessInstalment" ADD CONSTRAINT "WellnessInstalment_enrolmentId_fkey" FOREIGN KEY ("enrolmentId") REFERENCES "WellnessEnrolment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessUsage" ADD CONSTRAINT "WellnessUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessUsage" ADD CONSTRAINT "WellnessUsage_enrolmentId_fkey" FOREIGN KEY ("enrolmentId") REFERENCES "WellnessEnrolment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessUsage" ADD CONSTRAINT "WellnessUsage_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "WellnessEntitlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessUsage" ADD CONSTRAINT "WellnessUsage_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalChart" ADD CONSTRAINT "DentalChart_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalChart" ADD CONSTRAINT "DentalChart_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalChart" ADD CONSTRAINT "DentalChart_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalToothFinding" ADD CONSTRAINT "DentalToothFinding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalToothFinding" ADD CONSTRAINT "DentalToothFinding_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "DentalChart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalProcedure" ADD CONSTRAINT "DentalProcedure_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalProcedure" ADD CONSTRAINT "DentalProcedure_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "DentalChart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalProcedure" ADD CONSTRAINT "DentalProcedure_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalChartAddendum" ADD CONSTRAINT "DentalChartAddendum_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalChartAddendum" ADD CONSTRAINT "DentalChartAddendum_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "DentalChart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalProcedurePrice" ADD CONSTRAINT "DentalProcedurePrice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalProcedurePrice" ADD CONSTRAINT "DentalProcedurePrice_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Rules the database keeps even if the app has a bug ──

-- Wellness plans
ALTER TABLE "WellnessPlan" ADD CONSTRAINT "WellnessPlan_amounts" CHECK ("priceMinor" >= 0 AND ("monthlyPriceMinor" IS NULL OR "monthlyPriceMinor" >= 0) AND "joiningFeeMinor" >= 0);
ALTER TABLE "WellnessPlan" ADD CONSTRAINT "WellnessPlan_duration" CHECK ("durationMonths" BETWEEN 1 AND 36);
ALTER TABLE "WellnessPlan" ADD CONSTRAINT "WellnessPlan_discounts" CHECK ("serviceDiscountBp" BETWEEN 0 AND 10000 AND "productDiscountBp" BETWEEN 0 AND 10000);
ALTER TABLE "WellnessPlanItem" ADD CONSTRAINT "WellnessPlanItem_quantity" CHECK ("quantity" > 0);
ALTER TABLE "WellnessPlanItem" ADD CONSTRAINT "WellnessPlanItem_target" CHECK (
  ("kind" = 'SERVICE' AND "serviceId" IS NOT NULL AND "productId" IS NULL AND "labTestId" IS NULL) OR
  ("kind" = 'PRODUCT' AND "productId" IS NOT NULL AND "serviceId" IS NULL AND "labTestId" IS NULL) OR
  ("kind" = 'LAB' AND "labTestId" IS NOT NULL AND "serviceId" IS NULL AND "productId" IS NULL));
ALTER TABLE "WellnessEnrolment" ADD CONSTRAINT "WellnessEnrolment_dates" CHECK ("endDate" >= "startDate");
ALTER TABLE "WellnessEnrolment" ADD CONSTRAINT "WellnessEnrolment_amounts" CHECK ("totalMinor" >= 0 AND "joiningFeeMinor" >= 0 AND "serviceDiscountBp" BETWEEN 0 AND 10000 AND "productDiscountBp" BETWEEN 0 AND 10000);
-- A patient is on at most one active plan at a time (a renewal starts the day after the last one ends).
ALTER TABLE "WellnessEnrolment" ADD CONSTRAINT "WellnessEnrolment_no_overlap"
  EXCLUDE USING gist ("patientId" WITH =, daterange("startDate", "endDate", '[]') WITH &&) WHERE ("status" = 'ACTIVE');
ALTER TABLE "WellnessEntitlement" ADD CONSTRAINT "WellnessEntitlement_quantity" CHECK ("quantity" > 0 AND "unitValueMinor" >= 0);
ALTER TABLE "WellnessInstalment" ADD CONSTRAINT "WellnessInstalment_amount" CHECK ("amountMinor" >= 0 AND "seq" > 0);
ALTER TABLE "WellnessUsage" ADD CONSTRAINT "WellnessUsage_amounts" CHECK ("quantity" >= 0 AND "savedMinor" >= 0);
-- A charge carries at most one benefit at a time (a reversed one may be followed by a new one).
CREATE UNIQUE INDEX "WellnessUsage_one_per_charge" ON "WellnessUsage" ("chargeId") WHERE "reversedAt" IS NULL AND "chargeId" IS NOT NULL;
-- Benefits are reversed, never deleted or changed.
CREATE OR REPLACE FUNCTION wellness_usage_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Wellness benefits cannot be deleted; reverse them instead';
  END IF;
  IF OLD."reversedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'A reversed wellness benefit cannot be changed';
  END IF;
  IF (to_jsonb(NEW) - 'reversedAt' - 'reversedReason' - 'reversedByName') IS DISTINCT FROM (to_jsonb(OLD) - 'reversedAt' - 'reversedReason' - 'reversedByName') THEN
    RAISE EXCEPTION 'A wellness benefit can only be reversed, not changed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER wellness_usage_guard BEFORE UPDATE OR DELETE ON "WellnessUsage" FOR EACH ROW EXECUTE FUNCTION wellness_usage_guard();

-- Charges: a discount is never negative or more than the line.
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_discount_range" CHECK ("discountMinor" >= 0 AND "discountMinor" <= ROUND("quantity" * "unitPriceMinor"));

-- Dental charts
ALTER TABLE "DentalChart" ADD CONSTRAINT "DentalChart_scores" CHECK (
  ("periodontalStage" IS NULL OR "periodontalStage" BETWEEN 0 AND 4) AND
  ("calculusIndex" IS NULL OR "calculusIndex" BETWEEN 0 AND 3) AND
  ("gingivalIndex" IS NULL OR "gingivalIndex" BETWEEN 0 AND 3));
ALTER TABLE "DentalChart" ADD CONSTRAINT "DentalChart_signed" CHECK ("status" <> 'SIGNED' OR ("signedAt" IS NOT NULL AND "signedById" IS NOT NULL AND "contentHash" IS NOT NULL));
ALTER TABLE "DentalToothFinding" ADD CONSTRAINT "DentalToothFinding_tooth" CHECK ("tooth" ~ '^[1-8](0[1-9]|1[01])$');
ALTER TABLE "DentalToothFinding" ADD CONSTRAINT "DentalToothFinding_scores" CHECK (
  ("trStage" IS NULL OR "trStage" BETWEEN 1 AND 5) AND
  ("pdStage" IS NULL OR "pdStage" BETWEEN 0 AND 4) AND
  ("mobility" IS NULL OR "mobility" BETWEEN 0 AND 3) AND
  ("furcation" IS NULL OR "furcation" BETWEEN 0 AND 3) AND
  ("calculus" IS NULL OR "calculus" BETWEEN 0 AND 3) AND
  ("gingivitis" IS NULL OR "gingivitis" BETWEEN 0 AND 3) AND
  ("probingMm" IS NULL OR "probingMm" BETWEEN 0 AND 30) AND
  ("recessionMm" IS NULL OR "recessionMm" BETWEEN 0 AND 30));
ALTER TABLE "DentalProcedure" ADD CONSTRAINT "DentalProcedure_tooth" CHECK ("tooth" IS NULL OR "tooth" ~ '^[1-8](0[1-9]|1[01])$');

-- A signed chart is a clinical record: it cannot be changed (except re-pointing patient/client in a merge) or deleted.
CREATE OR REPLACE FUNCTION dental_chart_lock() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'SIGNED' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Signed dental charts cannot be deleted';
    END IF;
    IF (to_jsonb(NEW) - 'patientId' - 'clientId' - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'patientId' - 'clientId' - 'updatedAt') THEN
      RAISE EXCEPTION 'Signed dental charts are locked; add an addendum instead';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER dental_chart_lock BEFORE UPDATE OR DELETE ON "DentalChart" FOR EACH ROW EXECUTE FUNCTION dental_chart_lock();

-- Teeth and procedures of a signed chart are locked with it.
CREATE OR REPLACE FUNCTION dental_child_lock() RETURNS trigger AS $$
DECLARE s text;
BEGIN
  SELECT "status"::text INTO s FROM "DentalChart" WHERE "id" = (CASE WHEN TG_OP = 'DELETE' THEN OLD."chartId" ELSE NEW."chartId" END);
  IF s = 'SIGNED' THEN
    RAISE EXCEPTION 'Signed dental charts are locked; add an addendum instead';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."chartId" <> OLD."chartId" THEN
    RAISE EXCEPTION 'Dental chart rows cannot move to another chart';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER dental_tooth_lock BEFORE INSERT OR UPDATE OR DELETE ON "DentalToothFinding" FOR EACH ROW EXECUTE FUNCTION dental_child_lock();
CREATE TRIGGER dental_procedure_lock BEFORE INSERT OR UPDATE OR DELETE ON "DentalProcedure" FOR EACH ROW EXECUTE FUNCTION dental_child_lock();
CREATE TRIGGER dental_addendum_append_only BEFORE UPDATE OR DELETE ON "DentalChartAddendum" FOR EACH ROW EXECUTE FUNCTION append_only();

-- ── Permissions for existing clinics' system roles (same as new clinics get) ──
INSERT INTO "RolePermission" ("roleId", "permission")
SELECT r.id, 'wellness.read' FROM "Role" r
WHERE r."isSystem" AND r."key" IN ('owner', 'practice_manager', 'veterinarian', 'nurse', 'receptionist', 'accountant')
ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permission")
SELECT r.id, 'wellness.enrol' FROM "Role" r
WHERE r."isSystem" AND r."key" IN ('owner', 'practice_manager', 'veterinarian', 'receptionist')
ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permission")
SELECT r.id, 'wellness.manage' FROM "Role" r
WHERE r."isSystem" AND r."key" IN ('owner', 'practice_manager')
ON CONFLICT DO NOTHING;
