-- CreateEnum
CREATE TYPE "FarmStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AnimalGroupKind" AS ENUM ('HERD', 'FLOCK', 'PEN', 'BATCH');

-- CreateEnum
CREATE TYPE "ProductionPurpose" AS ENUM ('DAIRY', 'BEEF', 'BREEDING', 'LAYER', 'BROILER', 'MEAT', 'WOOL', 'MIXED', 'OTHER');

-- CreateEnum
CREATE TYPE "AnimalGroupStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "LivestockEventType" AS ENUM ('MOVE', 'PURCHASE', 'SALE', 'TRANSFER', 'DEATH', 'CULL', 'BIRTH', 'PLACEMENT');

-- CreateEnum
CREATE TYPE "BreedingEventType" AS ENUM ('HEAT', 'SERVICE', 'INSEMINATION', 'PREGNANCY_CHECK', 'BIRTH', 'ABORTION', 'DRY_OFF');

-- CreateEnum
CREATE TYPE "PregnancyResult" AS ENUM ('PREGNANT', 'NOT_PREGNANT', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "ProductionKind" AS ENUM ('MILK', 'EGGS', 'FEED', 'BATCH_WEIGHT', 'MORTALITY', 'WATER');

-- CreateEnum
CREATE TYPE "GroupTreatmentKind" AS ENUM ('VACCINATION', 'PARASITE_CONTROL', 'TREATMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "OutbreakStatus" AS ENUM ('SUSPECTED', 'CONFIRMED', 'CONTROLLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FieldVisitStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BoardingUnitType" AS ENUM ('KENNEL', 'CATTERY', 'SUITE', 'STABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "BoardingStatus" AS ENUM ('RESERVED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BoardingLogKind" AS ENUM ('FEEDING', 'WALK', 'MEDICATION', 'NOTE', 'INCIDENT');

-- CreateEnum
CREATE TYPE "GroomingStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'READY', 'COLLECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PreAuthStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'QUERIED', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'PAID', 'CLOSED');

-- CreateEnum
CREATE TYPE "ClaimPayee" AS ENUM ('CLINIC', 'CLIENT');

-- CreateEnum
CREATE TYPE "ReferralDirection" AS ENUM ('OUTGOING', 'INCOMING');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('DRAFT', 'SENT', 'RECEIVED', 'ACCEPTED', 'COMPLETED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReferralUrgency" AS ENUM ('ROUTINE', 'URGENT', 'EMERGENCY');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'INSURANCE';

-- DropIndex
DROP INDEX "PortalAccess_portalUserId_idx";

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "damId" UUID,
ADD COLUMN     "farmId" UUID,
ADD COLUMN     "groupId" UUID,
ADD COLUMN     "sireId" UUID;

-- AlterTable
ALTER TABLE "Species" ADD COLUMN     "gestationDays" INTEGER,
ADD COLUMN     "gestationSource" TEXT;

-- CreateTable
CREATE TABLE "Farm" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "clientId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "address" TEXT,
    "district" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "areaHectares" DECIMAL(10,2),
    "notes" TEXT,
    "status" "FarmStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Farm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimalGroup" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AnimalGroupKind" NOT NULL,
    "speciesId" UUID NOT NULL,
    "purpose" "ProductionPurpose" NOT NULL DEFAULT 'MIXED',
    "tracksIndividuals" BOOLEAN NOT NULL DEFAULT true,
    "headCount" INTEGER NOT NULL DEFAULT 0,
    "initialCount" INTEGER,
    "placedOn" DATE,
    "breedText" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "status" "AnimalGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "closedAt" TIMESTAMPTZ(3),
    "closedReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AnimalGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivestockMovement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" "LivestockEventType" NOT NULL,
    "patientId" UUID,
    "fromFarmId" UUID,
    "toFarmId" UUID,
    "fromGroupId" UUID,
    "toGroupId" UUID,
    "headCount" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "counterparty" TEXT,
    "priceMinor" INTEGER,
    "reason" TEXT,
    "recordedById" UUID,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LivestockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreedingEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "type" "BreedingEventType" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "sireId" UUID,
    "sireText" TEXT,
    "semenBatch" TEXT,
    "technician" TEXT,
    "method" TEXT,
    "result" "PregnancyResult",
    "expectedDueDate" DATE,
    "dueDateSource" TEXT,
    "offspringCount" INTEGER,
    "liveCount" INTEGER,
    "notes" TEXT,
    "voidedAt" TIMESTAMPTZ(3),
    "voidReason" TEXT,
    "voidedByName" TEXT,
    "recordedById" UUID,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreedingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRecord" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "patientId" UUID,
    "groupId" UUID,
    "kind" "ProductionKind" NOT NULL,
    "recordedOn" DATE NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "session" TEXT,
    "notes" TEXT,
    "voidedAt" TIMESTAMPTZ(3),
    "voidReason" TEXT,
    "voidedByName" TEXT,
    "recordedById" UUID,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupTreatment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "groupId" UUID,
    "fieldVisitId" UUID,
    "kind" "GroupTreatmentKind" NOT NULL,
    "productId" UUID,
    "productName" TEXT NOT NULL,
    "batchNumber" TEXT,
    "route" TEXT,
    "dosePerHead" TEXT,
    "headCount" INTEGER NOT NULL,
    "quantityIssued" DECIMAL(14,4),
    "administeredAt" TIMESTAMPTZ(3) NOT NULL,
    "meatClearAt" TIMESTAMPTZ(3),
    "milkClearAt" TIMESTAMPTZ(3),
    "eggClearAt" TIMESTAMPTZ(3),
    "withdrawalSource" TEXT,
    "animalsRecorded" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "administeredById" UUID,
    "administeredByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupTreatment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiseaseOutbreak" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "farmId" UUID NOT NULL,
    "groupId" UUID,
    "disease" TEXT NOT NULL,
    "notifiable" BOOLEAN NOT NULL DEFAULT false,
    "status" "OutbreakStatus" NOT NULL DEFAULT 'SUSPECTED',
    "firstSeenOn" DATE NOT NULL,
    "confirmedOn" DATE,
    "closedOn" DATE,
    "diagnosisMethod" TEXT,
    "populationAtRisk" INTEGER,
    "affectedCount" INTEGER NOT NULL DEFAULT 0,
    "deathCount" INTEGER NOT NULL DEFAULT 0,
    "controlMeasures" TEXT,
    "reportedToAuthorityOn" DATE,
    "authorityReference" TEXT,
    "notes" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DiseaseOutbreak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldVisit" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "farmId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "appointmentId" UUID,
    "clinicianId" UUID,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "FieldVisitStatus" NOT NULL DEFAULT 'SCHEDULED',
    "calloutServiceId" UUID,
    "distanceKm" DECIMAL(8,1),
    "findings" TEXT,
    "recommendations" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "completedByName" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FieldVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldVisitItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "kind" "LineKind" NOT NULL,
    "serviceId" UUID,
    "productId" UUID,
    "patientId" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldVisitItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardingUnit" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "BoardingUnitType" NOT NULL DEFAULT 'KENNEL',
    "nightlyServiceId" UUID,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BoardingUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardingStay" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "patientId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "unitId" UUID,
    "status" "BoardingStatus" NOT NULL DEFAULT 'RESERVED',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "nightlyRateMinor" INTEGER NOT NULL DEFAULT 0,
    "nightlyServiceId" UUID,
    "feedingInstructions" TEXT,
    "medicationInstructions" TEXT,
    "belongings" TEXT,
    "behaviourNotes" TEXT,
    "emergencyContact" TEXT,
    "vaccinationOverride" TEXT,
    "checkedInAt" TIMESTAMPTZ(3),
    "checkedInByName" TEXT,
    "checkedOutAt" TIMESTAMPTZ(3),
    "checkedOutByName" TEXT,
    "nightsCharged" INTEGER,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BoardingStay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardingLog" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "stayId" UUID NOT NULL,
    "kind" "BoardingLogKind" NOT NULL,
    "text" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" UUID,
    "recordedByName" TEXT NOT NULL,

    CONSTRAINT "BoardingLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroomingJob" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "patientId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "appointmentId" UUID,
    "groomerId" UUID,
    "status" "GroomingStatus" NOT NULL DEFAULT 'WAITING',
    "instructions" TEXT,
    "coatCondition" TEXT,
    "behaviour" TEXT,
    "groomerNotes" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "readyAt" TIMESTAMPTZ(3),
    "collectedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GroomingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroomingJobService" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroomingJobService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceProvider" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "claimsEmail" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InsuranceProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsurancePolicy" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "planName" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "excessMinor" INTEGER,
    "coverLimitMinor" INTEGER,
    "coPayPercent" INTEGER,
    "exclusions" TEXT,
    "notes" TEXT,
    "status" "PolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InsurancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreAuthorization" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "policyId" UUID NOT NULL,
    "procedure" TEXT NOT NULL,
    "estimateMinor" INTEGER NOT NULL,
    "estimateId" UUID,
    "status" "PreAuthStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "approvedMinor" INTEGER,
    "insurerReference" TEXT,
    "decisionNotes" TEXT,
    "notes" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PreAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceClaim" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "policyId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "condition" TEXT NOT NULL,
    "treatmentFrom" DATE NOT NULL,
    "treatmentTo" DATE NOT NULL,
    "payee" "ClaimPayee" NOT NULL DEFAULT 'CLINIC',
    "claimedMinor" INTEGER NOT NULL DEFAULT 0,
    "approvedMinor" INTEGER,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "clinicalSummary" TEXT,
    "submittedAt" TIMESTAMPTZ(3),
    "submittedByName" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "insurerReference" TEXT,
    "decisionNotes" TEXT,
    "paidAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InsuranceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceClaimInvoice" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsuranceClaimInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralContact" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "practice" TEXT,
    "specialty" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReferralContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "direction" "ReferralDirection" NOT NULL,
    "patientId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "contactId" UUID,
    "externalVet" TEXT,
    "urgency" "ReferralUrgency" NOT NULL DEFAULT 'ROUTINE',
    "reason" TEXT NOT NULL,
    "clinicalSummary" TEXT,
    "questions" TEXT,
    "status" "ReferralStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMPTZ(3),
    "sentByName" TEXT,
    "acceptedAt" TIMESTAMPTZ(3),
    "appointmentAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "outcome" TEXT,
    "declineReason" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Farm_organizationId_status_name_idx" ON "Farm"("organizationId", "status", "name");

-- CreateIndex
CREATE INDEX "Farm_clientId_idx" ON "Farm"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Farm_organizationId_number_key" ON "Farm"("organizationId", "number");

-- CreateIndex
CREATE INDEX "AnimalGroup_organizationId_status_idx" ON "AnimalGroup"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AnimalGroup_farmId_name_key" ON "AnimalGroup"("farmId", "name");

-- CreateIndex
CREATE INDEX "LivestockMovement_patientId_occurredAt_idx" ON "LivestockMovement"("patientId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "LivestockMovement_organizationId_occurredAt_idx" ON "LivestockMovement"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "LivestockMovement_fromFarmId_idx" ON "LivestockMovement"("fromFarmId");

-- CreateIndex
CREATE INDEX "LivestockMovement_toFarmId_idx" ON "LivestockMovement"("toFarmId");

-- CreateIndex
CREATE INDEX "BreedingEvent_patientId_occurredAt_idx" ON "BreedingEvent"("patientId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "BreedingEvent_organizationId_type_occurredAt_idx" ON "BreedingEvent"("organizationId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "ProductionRecord_farmId_kind_recordedOn_idx" ON "ProductionRecord"("farmId", "kind", "recordedOn");

-- CreateIndex
CREATE INDEX "ProductionRecord_patientId_recordedOn_idx" ON "ProductionRecord"("patientId", "recordedOn");

-- CreateIndex
CREATE INDEX "ProductionRecord_groupId_recordedOn_idx" ON "ProductionRecord"("groupId", "recordedOn");

-- CreateIndex
CREATE INDEX "GroupTreatment_farmId_administeredAt_idx" ON "GroupTreatment"("farmId", "administeredAt" DESC);

-- CreateIndex
CREATE INDEX "GroupTreatment_groupId_idx" ON "GroupTreatment"("groupId");

-- CreateIndex
CREATE INDEX "DiseaseOutbreak_organizationId_status_idx" ON "DiseaseOutbreak"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DiseaseOutbreak_farmId_idx" ON "DiseaseOutbreak"("farmId");

-- CreateIndex
CREATE UNIQUE INDEX "DiseaseOutbreak_organizationId_number_key" ON "DiseaseOutbreak"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "FieldVisit_appointmentId_key" ON "FieldVisit"("appointmentId");

-- CreateIndex
CREATE INDEX "FieldVisit_organizationId_scheduledAt_idx" ON "FieldVisit"("organizationId", "scheduledAt");

-- CreateIndex
CREATE INDEX "FieldVisit_farmId_scheduledAt_idx" ON "FieldVisit"("farmId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "FieldVisit_organizationId_number_key" ON "FieldVisit"("organizationId", "number");

-- CreateIndex
CREATE INDEX "FieldVisitItem_visitId_idx" ON "FieldVisitItem"("visitId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardingUnit_branchId_name_key" ON "BoardingUnit"("branchId", "name");

-- CreateIndex
CREATE INDEX "BoardingStay_organizationId_branchId_startDate_endDate_idx" ON "BoardingStay"("organizationId", "branchId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "BoardingStay_unitId_startDate_idx" ON "BoardingStay"("unitId", "startDate");

-- CreateIndex
CREATE INDEX "BoardingStay_patientId_idx" ON "BoardingStay"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardingStay_organizationId_number_key" ON "BoardingStay"("organizationId", "number");

-- CreateIndex
CREATE INDEX "BoardingLog_stayId_recordedAt_idx" ON "BoardingLog"("stayId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GroomingJob_appointmentId_key" ON "GroomingJob"("appointmentId");

-- CreateIndex
CREATE INDEX "GroomingJob_organizationId_branchId_createdAt_idx" ON "GroomingJob"("organizationId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "GroomingJob_patientId_idx" ON "GroomingJob"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "GroomingJob_organizationId_number_key" ON "GroomingJob"("organizationId", "number");

-- CreateIndex
CREATE INDEX "GroomingJobService_jobId_idx" ON "GroomingJobService"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceProvider_organizationId_name_key" ON "InsuranceProvider"("organizationId", "name");

-- CreateIndex
CREATE INDEX "InsurancePolicy_patientId_idx" ON "InsurancePolicy"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "InsurancePolicy_organizationId_providerId_policyNumber_key" ON "InsurancePolicy"("organizationId", "providerId", "policyNumber");

-- CreateIndex
CREATE INDEX "PreAuthorization_policyId_idx" ON "PreAuthorization"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "PreAuthorization_organizationId_number_key" ON "PreAuthorization"("organizationId", "number");

-- CreateIndex
CREATE INDEX "InsuranceClaim_organizationId_status_idx" ON "InsuranceClaim"("organizationId", "status");

-- CreateIndex
CREATE INDEX "InsuranceClaim_patientId_idx" ON "InsuranceClaim"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceClaim_organizationId_number_key" ON "InsuranceClaim"("organizationId", "number");

-- CreateIndex
CREATE INDEX "InsuranceClaimInvoice_invoiceId_idx" ON "InsuranceClaimInvoice"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceClaimInvoice_claimId_invoiceId_key" ON "InsuranceClaimInvoice"("claimId", "invoiceId");

-- CreateIndex
CREATE INDEX "ReferralContact_organizationId_name_idx" ON "ReferralContact"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Referral_organizationId_status_idx" ON "Referral"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Referral_patientId_idx" ON "Referral"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_organizationId_number_key" ON "Referral"("organizationId", "number");

-- CreateIndex
CREATE INDEX "Patient_farmId_idx" ON "Patient"("farmId");

-- CreateIndex
CREATE INDEX "Patient_groupId_idx" ON "Patient"("groupId");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AnimalGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_sireId_fkey" FOREIGN KEY ("sireId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_damId_fkey" FOREIGN KEY ("damId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Farm" ADD CONSTRAINT "Farm_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Farm" ADD CONSTRAINT "Farm_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalGroup" ADD CONSTRAINT "AnimalGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalGroup" ADD CONSTRAINT "AnimalGroup_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalGroup" ADD CONSTRAINT "AnimalGroup_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "Species"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivestockMovement" ADD CONSTRAINT "LivestockMovement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivestockMovement" ADD CONSTRAINT "LivestockMovement_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivestockMovement" ADD CONSTRAINT "LivestockMovement_fromFarmId_fkey" FOREIGN KEY ("fromFarmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivestockMovement" ADD CONSTRAINT "LivestockMovement_toFarmId_fkey" FOREIGN KEY ("toFarmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivestockMovement" ADD CONSTRAINT "LivestockMovement_fromGroupId_fkey" FOREIGN KEY ("fromGroupId") REFERENCES "AnimalGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivestockMovement" ADD CONSTRAINT "LivestockMovement_toGroupId_fkey" FOREIGN KEY ("toGroupId") REFERENCES "AnimalGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreedingEvent" ADD CONSTRAINT "BreedingEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreedingEvent" ADD CONSTRAINT "BreedingEvent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreedingEvent" ADD CONSTRAINT "BreedingEvent_sireId_fkey" FOREIGN KEY ("sireId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRecord" ADD CONSTRAINT "ProductionRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRecord" ADD CONSTRAINT "ProductionRecord_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRecord" ADD CONSTRAINT "ProductionRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRecord" ADD CONSTRAINT "ProductionRecord_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AnimalGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupTreatment" ADD CONSTRAINT "GroupTreatment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupTreatment" ADD CONSTRAINT "GroupTreatment_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupTreatment" ADD CONSTRAINT "GroupTreatment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AnimalGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupTreatment" ADD CONSTRAINT "GroupTreatment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupTreatment" ADD CONSTRAINT "GroupTreatment_fieldVisitId_fkey" FOREIGN KEY ("fieldVisitId") REFERENCES "FieldVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiseaseOutbreak" ADD CONSTRAINT "DiseaseOutbreak_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiseaseOutbreak" ADD CONSTRAINT "DiseaseOutbreak_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiseaseOutbreak" ADD CONSTRAINT "DiseaseOutbreak_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AnimalGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisit" ADD CONSTRAINT "FieldVisit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisit" ADD CONSTRAINT "FieldVisit_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisit" ADD CONSTRAINT "FieldVisit_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisit" ADD CONSTRAINT "FieldVisit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisit" ADD CONSTRAINT "FieldVisit_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisit" ADD CONSTRAINT "FieldVisit_clinicianId_fkey" FOREIGN KEY ("clinicianId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisitItem" ADD CONSTRAINT "FieldVisitItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisitItem" ADD CONSTRAINT "FieldVisitItem_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "FieldVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisitItem" ADD CONSTRAINT "FieldVisitItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisitItem" ADD CONSTRAINT "FieldVisitItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingUnit" ADD CONSTRAINT "BoardingUnit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingUnit" ADD CONSTRAINT "BoardingUnit_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingUnit" ADD CONSTRAINT "BoardingUnit_nightlyServiceId_fkey" FOREIGN KEY ("nightlyServiceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingStay" ADD CONSTRAINT "BoardingStay_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingStay" ADD CONSTRAINT "BoardingStay_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingStay" ADD CONSTRAINT "BoardingStay_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingStay" ADD CONSTRAINT "BoardingStay_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingStay" ADD CONSTRAINT "BoardingStay_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BoardingUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingLog" ADD CONSTRAINT "BoardingLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingLog" ADD CONSTRAINT "BoardingLog_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "BoardingStay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomingJob" ADD CONSTRAINT "GroomingJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomingJob" ADD CONSTRAINT "GroomingJob_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomingJob" ADD CONSTRAINT "GroomingJob_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomingJob" ADD CONSTRAINT "GroomingJob_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomingJob" ADD CONSTRAINT "GroomingJob_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomingJob" ADD CONSTRAINT "GroomingJob_groomerId_fkey" FOREIGN KEY ("groomerId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomingJobService" ADD CONSTRAINT "GroomingJobService_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomingJobService" ADD CONSTRAINT "GroomingJobService_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GroomingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomingJobService" ADD CONSTRAINT "GroomingJobService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceProvider" ADD CONSTRAINT "InsuranceProvider_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "InsuranceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreAuthorization" ADD CONSTRAINT "PreAuthorization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreAuthorization" ADD CONSTRAINT "PreAuthorization_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "InsurancePolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "InsurancePolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaimInvoice" ADD CONSTRAINT "InsuranceClaimInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaimInvoice" ADD CONSTRAINT "InsuranceClaimInvoice_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "InsuranceClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaimInvoice" ADD CONSTRAINT "InsuranceClaimInvoice_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralContact" ADD CONSTRAINT "ReferralContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "ReferralContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Integrity rules (Milestone 8) ──
ALTER TABLE "AnimalGroup" ADD CONSTRAINT "AnimalGroup_headCount_nonneg" CHECK ("headCount" >= 0);
ALTER TABLE "LivestockMovement" ADD CONSTRAINT "LivestockMovement_headCount_positive" CHECK ("headCount" > 0);
ALTER TABLE "BreedingEvent" ADD CONSTRAINT "BreedingEvent_counts" CHECK (("offspringCount" IS NULL OR "offspringCount" >= 0) AND ("liveCount" IS NULL OR ("liveCount" >= 0 AND ("offspringCount" IS NULL OR "liveCount" <= "offspringCount"))));
ALTER TABLE "ProductionRecord" ADD CONSTRAINT "ProductionRecord_quantity_nonneg" CHECK ("quantity" >= 0);
ALTER TABLE "ProductionRecord" ADD CONSTRAINT "ProductionRecord_subject" CHECK ("patientId" IS NOT NULL OR "groupId" IS NOT NULL OR "kind" IN ('FEED', 'WATER', 'MILK', 'EGGS'));
ALTER TABLE "GroupTreatment" ADD CONSTRAINT "GroupTreatment_headCount_positive" CHECK ("headCount" > 0);
ALTER TABLE "DiseaseOutbreak" ADD CONSTRAINT "DiseaseOutbreak_counts" CHECK ("affectedCount" >= 0 AND "deathCount" >= 0 AND "deathCount" <= GREATEST("affectedCount", "deathCount"));
ALTER TABLE "FieldVisitItem" ADD CONSTRAINT "FieldVisitItem_amounts" CHECK ("quantity" > 0 AND "unitPriceMinor" >= 0);
ALTER TABLE "BoardingStay" ADD CONSTRAINT "BoardingStay_dates" CHECK ("endDate" > "startDate");
ALTER TABLE "BoardingStay" ADD CONSTRAINT "BoardingStay_rate_nonneg" CHECK ("nightlyRateMinor" >= 0);
ALTER TABLE "GroomingJobService" ADD CONSTRAINT "GroomingJobService_price_nonneg" CHECK ("priceMinor" >= 0);
ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_amounts" CHECK (("excessMinor" IS NULL OR "excessMinor" >= 0) AND ("coverLimitMinor" IS NULL OR "coverLimitMinor" >= 0) AND ("coPayPercent" IS NULL OR "coPayPercent" BETWEEN 0 AND 100) AND ("endDate" IS NULL OR "endDate" >= "startDate"));
ALTER TABLE "PreAuthorization" ADD CONSTRAINT "PreAuthorization_amounts" CHECK ("estimateMinor" >= 0 AND ("approvedMinor" IS NULL OR "approvedMinor" >= 0));
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_amounts" CHECK ("claimedMinor" >= 0 AND "paidMinor" >= 0 AND ("approvedMinor" IS NULL OR "approvedMinor" >= 0) AND "treatmentTo" >= "treatmentFrom");
ALTER TABLE "InsuranceClaimInvoice" ADD CONSTRAINT "InsuranceClaimInvoice_amount_positive" CHECK ("amountMinor" > 0);

-- An animal is in at most one active boarding stay at a time.
CREATE UNIQUE INDEX "BoardingStay_one_active_per_patient" ON "BoardingStay"("patientId") WHERE "status" = 'CHECKED_IN';

-- Movement history and boarding care logs are append-only (re-pointing the animal in a merge is allowed).
CREATE OR REPLACE FUNCTION livestock_movement_lock() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Movement records cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - 'patientId') IS DISTINCT FROM (to_jsonb(OLD) - 'patientId') THEN
    RAISE EXCEPTION 'Movement records cannot be changed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER livestock_movement_lock BEFORE UPDATE OR DELETE ON "LivestockMovement" FOR EACH ROW EXECUTE FUNCTION livestock_movement_lock();
CREATE TRIGGER boarding_log_append_only BEFORE UPDATE OR DELETE ON "BoardingLog" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER group_treatment_append_only BEFORE DELETE ON "GroupTreatment" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE OR REPLACE FUNCTION group_treatment_lock() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Group treatment records cannot be changed';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER group_treatment_lock BEFORE UPDATE ON "GroupTreatment" FOR EACH ROW EXECUTE FUNCTION group_treatment_lock();

-- Breeding and production records are never edited or deleted: a mistaken entry is voided once, with a reason.
CREATE OR REPLACE FUNCTION voidable_record_lock() RETURNS trigger AS $$
DECLARE
  movable text[] := ARRAY['patientId', 'sireId', 'voidedAt', 'voidReason', 'voidedByName'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows cannot be deleted; void them instead', TG_TABLE_NAME;
  END IF;
  IF OLD."voidedAt" IS NOT NULL AND (NEW."voidedAt" IS DISTINCT FROM OLD."voidedAt" OR NEW."voidReason" IS DISTINCT FROM OLD."voidReason") THEN
    RAISE EXCEPTION 'This record has already been voided';
  END IF;
  IF (to_jsonb(NEW) - movable) IS DISTINCT FROM (to_jsonb(OLD) - movable) THEN
    RAISE EXCEPTION '% rows cannot be changed; void and re-enter instead', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER breeding_event_lock BEFORE UPDATE OR DELETE ON "BreedingEvent" FOR EACH ROW EXECUTE FUNCTION voidable_record_lock();
CREATE TRIGGER production_record_lock BEFORE UPDATE OR DELETE ON "ProductionRecord" FOR EACH ROW EXECUTE FUNCTION voidable_record_lock();

-- A completed field visit is a clinical record: findings cannot be changed afterwards (merges may re-point the client).
CREATE OR REPLACE FUNCTION field_visit_lock() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Field visits cannot be deleted; cancel them instead';
  END IF;
  IF OLD."status" IN ('COMPLETED', 'CANCELLED') AND (to_jsonb(NEW) - 'clientId' - 'appointmentId' - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'clientId' - 'appointmentId' - 'updatedAt') THEN
    RAISE EXCEPTION 'Completed or cancelled field visits cannot be changed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER field_visit_lock BEFORE UPDATE OR DELETE ON "FieldVisit" FOR EACH ROW EXECUTE FUNCTION field_visit_lock();
CREATE TRIGGER field_visit_item_append_only BEFORE UPDATE OR DELETE ON "FieldVisitItem" FOR EACH ROW EXECUTE FUNCTION append_only();
