-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('MEDICINE', 'VACCINE', 'CONSUMABLE', 'RETAIL', 'FOOD', 'EQUIPMENT');

-- CreateEnum
CREATE TYPE "DosageForm" AS ENUM ('TABLET', 'CAPSULE', 'ORAL_LIQUID', 'ORAL_PASTE', 'INJECTION', 'INFUSION', 'TOPICAL', 'OPHTHALMIC', 'OTIC', 'SPOT_ON', 'POUR_ON', 'BOLUS', 'INTRAMAMMARY', 'POWDER', 'IMPLANT', 'INHALANT', 'OTHER');

-- CreateEnum
CREATE TYPE "DoseReferenceStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('DRAFT', 'AUTHORIZED', 'PARTIALLY_DISPENSED', 'DISPENSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdministrationStatus" AS ENUM ('GIVEN', 'NOT_GIVEN');

-- CreateEnum
CREATE TYPE "LabCategory" AS ENUM ('HAEMATOLOGY', 'BIOCHEMISTRY', 'URINALYSIS', 'PARASITOLOGY', 'MICROBIOLOGY', 'CYTOLOGY', 'HISTOPATHOLOGY', 'SEROLOGY', 'ENDOCRINOLOGY', 'MOLECULAR', 'IMAGING', 'OTHER');

-- CreateEnum
CREATE TYPE "SampleType" AS ENUM ('WHOLE_BLOOD_EDTA', 'SERUM', 'PLASMA', 'URINE', 'FAECES', 'SWAB', 'TISSUE', 'MILK', 'SKIN_SCRAPING', 'FLUID', 'OTHER', 'NONE');

-- CreateEnum
CREATE TYPE "ResultType" AS ENUM ('NUMERIC', 'TEXT', 'OPTION');

-- CreateEnum
CREATE TYPE "OrderPriority" AS ENUM ('ROUTINE', 'URGENT', 'STAT');

-- CreateEnum
CREATE TYPE "DiagnosticOrderStatus" AS ENUM ('ORDERED', 'COLLECTED', 'IN_PROGRESS', 'AWAITING_VALIDATION', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('PENDING', 'RESULTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SampleStatus" AS ENUM ('COLLECTED', 'RECEIVED', 'IN_ANALYSIS', 'REJECTED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "ResultFlag" AS ENUM ('NORMAL', 'LOW', 'HIGH', 'CRITICAL_LOW', 'CRITICAL_HIGH', 'ABNORMAL');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('PRELIMINARY', 'FINAL', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "genericName" TEXT,
    "type" "ProductType" NOT NULL DEFAULT 'MEDICINE',
    "category" TEXT,
    "form" "DosageForm",
    "strengthValue" DECIMAL(14,4),
    "strengthUnit" TEXT,
    "dispensingUnit" TEXT NOT NULL DEFAULT 'unit',
    "minDispenseIncrement" DECIMAL(10,4) NOT NULL DEFAULT 1,
    "activeIngredients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "manufacturer" TEXT,
    "requiresPrescription" BOOLEAN NOT NULL DEFAULT true,
    "isControlled" BOOLEAN NOT NULL DEFAULT false,
    "controlledSchedule" TEXT,
    "targetSpecies" "SpeciesCategory"[] DEFAULT ARRAY[]::"SpeciesCategory"[],
    "sellPriceMinor" INTEGER,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductWithdrawal" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "speciesId" UUID NOT NULL,
    "meatDays" INTEGER,
    "milkHours" INTEGER,
    "eggDays" INTEGER,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoseReference" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "speciesId" UUID NOT NULL,
    "indication" TEXT,
    "route" TEXT NOT NULL,
    "doseMin" DECIMAL(14,4) NOT NULL,
    "doseMax" DECIMAL(14,4) NOT NULL,
    "doseUnit" TEXT NOT NULL,
    "frequency" TEXT,
    "maxPerDose" DECIMAL(14,4),
    "notes" TEXT,
    "source" TEXT NOT NULL,
    "status" "DoseReferenceStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByName" TEXT,
    "approvedById" UUID,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DoseReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "patientId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "encounterId" UUID,
    "prescriberId" UUID,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'DRAFT',
    "weightKg" DECIMAL(9,3),
    "notes" TEXT,
    "validUntil" DATE,
    "repeatOfId" UUID,
    "authorizedById" UUID,
    "authorizedByName" TEXT,
    "authorizedAt" TIMESTAMPTZ(3),
    "contentHash" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdById" UUID,
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "prescriptionId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "route" TEXT NOT NULL,
    "doseValue" DECIMAL(14,4) NOT NULL,
    "doseUnit" TEXT NOT NULL,
    "weightKgUsed" DECIMAL(9,3),
    "amountPerDose" DECIMAL(14,4) NOT NULL,
    "frequencyPerDay" DECIMAL(6,3),
    "frequencyText" TEXT NOT NULL,
    "durationDays" INTEGER,
    "quantity" DECIMAL(14,4) NOT NULL,
    "quantityDispensed" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "repeats" INTEGER NOT NULL DEFAULT 0,
    "instructions" TEXT NOT NULL,
    "doseReferenceId" UUID,
    "warnings" JSONB,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispensation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "prescriptionItemId" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "batchNumber" TEXT,
    "expiryDate" DATE,
    "notes" TEXT,
    "dispensedById" UUID NOT NULL,
    "dispensedByName" TEXT NOT NULL,
    "dispensedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationAdministration" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "encounterId" UUID,
    "productId" UUID NOT NULL,
    "prescriptionItemId" UUID,
    "status" "AdministrationStatus" NOT NULL DEFAULT 'GIVEN',
    "dose" DECIMAL(14,4) NOT NULL,
    "doseUnit" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "site" TEXT,
    "batchNumber" TEXT,
    "expiryDate" DATE,
    "reasonNotGiven" TEXT,
    "notes" TEXT,
    "administeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "administeredById" UUID NOT NULL,
    "administeredByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationAdministration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientWithdrawal" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "treatedAt" TIMESTAMPTZ(3) NOT NULL,
    "meatClearAt" TIMESTAMPTZ(3),
    "milkClearAt" TIMESTAMPTZ(3),
    "eggClearAt" TIMESTAMPTZ(3),
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabTest" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "LabCategory" NOT NULL,
    "sampleType" "SampleType" NOT NULL DEFAULT 'NONE',
    "performedBy" TEXT NOT NULL DEFAULT 'IN_HOUSE',
    "externalLabName" TEXT,
    "modality" TEXT,
    "priceMinor" INTEGER,
    "turnaroundHours" INTEGER,
    "instructions" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LabTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabAnalyte" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "resultType" "ResultType" NOT NULL DEFAULT 'NUMERIC',
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decimals" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LabAnalyte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceInterval" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "analyteId" UUID NOT NULL,
    "speciesId" UUID NOT NULL,
    "sex" "PatientSex",
    "ageMinMonths" INTEGER,
    "ageMaxMonths" INTEGER,
    "low" DECIMAL(14,4),
    "high" DECIMAL(14,4),
    "criticalLow" DECIMAL(14,4),
    "criticalHigh" DECIMAL(14,4),
    "source" TEXT NOT NULL,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceInterval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticOrder" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "patientId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "encounterId" UUID,
    "priority" "OrderPriority" NOT NULL DEFAULT 'ROUTINE',
    "status" "DiagnosticOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "clinicalNotes" TEXT,
    "externalReference" TEXT,
    "hasCritical" BOOLEAN NOT NULL DEFAULT false,
    "orderedById" UUID NOT NULL,
    "orderedByName" TEXT NOT NULL,
    "orderingMembershipId" UUID,
    "releasedById" UUID,
    "releasedByName" TEXT,
    "releasedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DiagnosticOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticOrderItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "status" "OrderItemStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosticOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sample" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "sampleType" "SampleType" NOT NULL,
    "status" "SampleStatus" NOT NULL DEFAULT 'COLLECTED',
    "collectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectedById" UUID NOT NULL,
    "collectedByName" TEXT NOT NULL,
    "rejectionReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sampleId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "notes" TEXT,
    "byId" UUID NOT NULL,
    "byName" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SampleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabResult" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "analyteId" UUID NOT NULL,
    "valueNumeric" DECIMAL(14,4),
    "valueText" TEXT,
    "unit" TEXT,
    "refLow" DECIMAL(14,4),
    "refHigh" DECIMAL(14,4),
    "refSource" TEXT,
    "flag" "ResultFlag",
    "status" "ResultStatus" NOT NULL DEFAULT 'PRELIMINARY',
    "comment" TEXT,
    "enteredById" UUID NOT NULL,
    "enteredByName" TEXT NOT NULL,
    "enteredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesId" UUID,
    "amendmentReason" TEXT,

    CONSTRAINT "LabResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImagingReport" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "modality" TEXT NOT NULL,
    "bodyRegion" TEXT,
    "views" TEXT,
    "findings" TEXT NOT NULL,
    "conclusion" TEXT NOT NULL,
    "recommendations" TEXT,
    "studyInstanceUid" TEXT,
    "reportedById" UUID NOT NULL,
    "reportedByName" TEXT NOT NULL,
    "reportedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ImagingReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_organizationId_type_name_idx" ON "Product"("organizationId", "type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_organizationId_sku_key" ON "Product"("organizationId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductWithdrawal_productId_speciesId_key" ON "ProductWithdrawal"("productId", "speciesId");

-- CreateIndex
CREATE INDEX "DoseReference_productId_speciesId_status_idx" ON "DoseReference"("productId", "speciesId", "status");

-- CreateIndex
CREATE INDEX "Prescription_organizationId_status_createdAt_idx" ON "Prescription"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Prescription_patientId_createdAt_idx" ON "Prescription"("patientId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_organizationId_number_key" ON "Prescription"("organizationId", "number");

-- CreateIndex
CREATE INDEX "PrescriptionItem_prescriptionId_idx" ON "PrescriptionItem"("prescriptionId");

-- CreateIndex
CREATE INDEX "Dispensation_prescriptionItemId_idx" ON "Dispensation"("prescriptionItemId");

-- CreateIndex
CREATE INDEX "Dispensation_organizationId_dispensedAt_idx" ON "Dispensation"("organizationId", "dispensedAt");

-- CreateIndex
CREATE INDEX "MedicationAdministration_patientId_administeredAt_idx" ON "MedicationAdministration"("patientId", "administeredAt" DESC);

-- CreateIndex
CREATE INDEX "PatientWithdrawal_patientId_treatedAt_idx" ON "PatientWithdrawal"("patientId", "treatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "LabTest_organizationId_code_key" ON "LabTest"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LabAnalyte_testId_code_key" ON "LabAnalyte"("testId", "code");

-- CreateIndex
CREATE INDEX "ReferenceInterval_analyteId_speciesId_idx" ON "ReferenceInterval"("analyteId", "speciesId");

-- CreateIndex
CREATE INDEX "DiagnosticOrder_organizationId_status_createdAt_idx" ON "DiagnosticOrder"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DiagnosticOrder_patientId_createdAt_idx" ON "DiagnosticOrder"("patientId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticOrder_organizationId_number_key" ON "DiagnosticOrder"("organizationId", "number");

-- CreateIndex
CREATE INDEX "DiagnosticOrderItem_orderId_idx" ON "DiagnosticOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "Sample_orderId_idx" ON "Sample"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Sample_organizationId_barcode_key" ON "Sample"("organizationId", "barcode");

-- CreateIndex
CREATE INDEX "SampleEvent_sampleId_at_idx" ON "SampleEvent"("sampleId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "LabResult_supersedesId_key" ON "LabResult"("supersedesId");

-- CreateIndex
CREATE INDEX "LabResult_orderItemId_analyteId_idx" ON "LabResult"("orderItemId", "analyteId");

-- CreateIndex
CREATE UNIQUE INDEX "ImagingReport_orderItemId_key" ON "ImagingReport"("orderItemId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductWithdrawal" ADD CONSTRAINT "ProductWithdrawal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductWithdrawal" ADD CONSTRAINT "ProductWithdrawal_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductWithdrawal" ADD CONSTRAINT "ProductWithdrawal_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "Species"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoseReference" ADD CONSTRAINT "DoseReference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoseReference" ADD CONSTRAINT "DoseReference_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoseReference" ADD CONSTRAINT "DoseReference_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "Species"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_prescriberId_fkey" FOREIGN KEY ("prescriberId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_doseReferenceId_fkey" FOREIGN KEY ("doseReferenceId") REFERENCES "DoseReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispensation" ADD CONSTRAINT "Dispensation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispensation" ADD CONSTRAINT "Dispensation_prescriptionItemId_fkey" FOREIGN KEY ("prescriptionItemId") REFERENCES "PrescriptionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_prescriptionItemId_fkey" FOREIGN KEY ("prescriptionItemId") REFERENCES "PrescriptionItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientWithdrawal" ADD CONSTRAINT "PatientWithdrawal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientWithdrawal" ADD CONSTRAINT "PatientWithdrawal_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientWithdrawal" ADD CONSTRAINT "PatientWithdrawal_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabTest" ADD CONSTRAINT "LabTest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabAnalyte" ADD CONSTRAINT "LabAnalyte_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabAnalyte" ADD CONSTRAINT "LabAnalyte_testId_fkey" FOREIGN KEY ("testId") REFERENCES "LabTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceInterval" ADD CONSTRAINT "ReferenceInterval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceInterval" ADD CONSTRAINT "ReferenceInterval_analyteId_fkey" FOREIGN KEY ("analyteId") REFERENCES "LabAnalyte"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceInterval" ADD CONSTRAINT "ReferenceInterval_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "Species"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticOrder" ADD CONSTRAINT "DiagnosticOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticOrder" ADD CONSTRAINT "DiagnosticOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticOrder" ADD CONSTRAINT "DiagnosticOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticOrder" ADD CONSTRAINT "DiagnosticOrder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticOrder" ADD CONSTRAINT "DiagnosticOrder_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticOrderItem" ADD CONSTRAINT "DiagnosticOrderItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticOrderItem" ADD CONSTRAINT "DiagnosticOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DiagnosticOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticOrderItem" ADD CONSTRAINT "DiagnosticOrderItem_testId_fkey" FOREIGN KEY ("testId") REFERENCES "LabTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DiagnosticOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleEvent" ADD CONSTRAINT "SampleEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleEvent" ADD CONSTRAINT "SampleEvent_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "DiagnosticOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_analyteId_fkey" FOREIGN KEY ("analyteId") REFERENCES "LabAnalyte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "LabResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingReport" ADD CONSTRAINT "ImagingReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingReport" ADD CONSTRAINT "ImagingReport_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "DiagnosticOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Quantity sanity
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_quantities" CHECK (quantity > 0 AND "amountPerDose" > 0 AND "quantityDispensed" >= 0 AND "quantityDispensed" <= quantity * (1 + repeats));
ALTER TABLE "Dispensation" ADD CONSTRAINT "Dispensation_positive" CHECK (quantity > 0);
ALTER TABLE "DoseReference" ADD CONSTRAINT "DoseReference_range" CHECK ("doseMax" >= "doseMin" AND "doseMin" >= 0);

-- Items of an authorised prescription are frozen; only the dispensed quantity may change.
CREATE OR REPLACE FUNCTION prescription_item_frozen() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM "Prescription" WHERE id = COALESCE(OLD."prescriptionId", NEW."prescriptionId");
  IF st IS NULL OR st = 'DRAFT' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Items of an authorised prescription cannot be removed'; END IF;
  IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'Items cannot be added to an authorised prescription'; END IF;
  IF NEW."productId" IS DISTINCT FROM OLD."productId" OR NEW."doseValue" IS DISTINCT FROM OLD."doseValue"
     OR NEW."doseUnit" IS DISTINCT FROM OLD."doseUnit" OR NEW."amountPerDose" IS DISTINCT FROM OLD."amountPerDose"
     OR NEW.route IS DISTINCT FROM OLD.route OR NEW."frequencyText" IS DISTINCT FROM OLD."frequencyText"
     OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.instructions IS DISTINCT FROM OLD.instructions
     OR NEW.repeats IS DISTINCT FROM OLD.repeats OR NEW."durationDays" IS DISTINCT FROM OLD."durationDays" THEN
    RAISE EXCEPTION 'Authorised prescriptions are immutable; cancel and re-prescribe instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER prescription_item_frozen BEFORE INSERT OR UPDATE OR DELETE ON "PrescriptionItem"
  FOR EACH ROW EXECUTE FUNCTION prescription_item_frozen();

-- Final lab results are immutable; corrections are new rows that supersede them.
CREATE OR REPLACE FUNCTION lab_result_final_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status NOT IN ('FINAL', 'SUPERSEDED') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Final lab results cannot be deleted'; END IF;
  IF NEW."valueNumeric" IS DISTINCT FROM OLD."valueNumeric" OR NEW."valueText" IS DISTINCT FROM OLD."valueText"
     OR NEW.flag IS DISTINCT FROM OLD.flag OR NEW."refLow" IS DISTINCT FROM OLD."refLow" OR NEW."refHigh" IS DISTINCT FROM OLD."refHigh"
     OR NEW."enteredById" IS DISTINCT FROM OLD."enteredById" OR NEW."analyteId" IS DISTINCT FROM OLD."analyteId"
     OR NOT (NEW.status = OLD.status OR (OLD.status = 'FINAL' AND NEW.status = 'SUPERSEDED')) THEN
    RAISE EXCEPTION 'Final lab results are immutable; record an amended result instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER lab_result_immutable BEFORE UPDATE OR DELETE ON "LabResult"
  FOR EACH ROW EXECUTE FUNCTION lab_result_final_immutable();
