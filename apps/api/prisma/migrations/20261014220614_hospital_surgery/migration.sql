-- CreateEnum
CREATE TYPE "WardType" AS ENUM ('GENERAL', 'ICU', 'ISOLATION', 'CATTERY', 'KENNEL', 'LARGE_ANIMAL', 'EXOTICS', 'OTHER');

-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('ADMITTED', 'DISCHARGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdmissionOutcome" AS ENUM ('DISCHARGED_HOME', 'TRANSFERRED', 'DECEASED', 'EUTHANASED');

-- CreateEnum
CREATE TYPE "PatientCondition" AS ENUM ('STABLE', 'FAIR', 'GUARDED', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CprStatus" AS ENUM ('UNDECIDED', 'CPR', 'DNR');

-- CreateEnum
CREATE TYPE "TreatmentKind" AS ENUM ('MEDICATION', 'FLUID', 'FEEDING', 'NURSING', 'OBSERVATION', 'OTHER');

-- CreateEnum
CREATE TYPE "TreatmentSchedule" AS ENUM ('INTERVAL', 'ONCE', 'AS_NEEDED', 'CONTINUOUS');

-- CreateEnum
CREATE TYPE "TreatmentOrderStatus" AS ENUM ('ACTIVE', 'STOPPED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TreatmentTaskStatus" AS ENUM ('DUE', 'DONE', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HospitalNoteType" AS ENUM ('PROGRESS', 'HANDOVER', 'ALERT');

-- CreateEnum
CREATE TYPE "SurgeryStatus" AS ENUM ('SCHEDULED', 'PRE_OP', 'IN_PROGRESS', 'RECOVERY', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SurgeryPriority" AS ENUM ('ELECTIVE', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "AsaGrade" AS ENUM ('I', 'II', 'III', 'IV', 'V');

-- CreateEnum
CREATE TYPE "SurgeryRole" AS ENUM ('SURGEON', 'ASSISTANT', 'ANAESTHETIST', 'NURSE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReadingPhase" AS ENUM ('INTRA_OP', 'RECOVERY');

-- CreateEnum
CREATE TYPE "ChecklistPhase" AS ENUM ('SIGN_IN', 'TIME_OUT', 'SIGN_OUT');

-- AlterEnum
ALTER TYPE "TaskType" ADD VALUE 'HOSPITAL_ALERT';

-- AlterTable
ALTER TABLE "VitalSign" ADD COLUMN     "admissionId" UUID;

-- CreateTable
CREATE TABLE "Ward" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WardType" NOT NULL DEFAULT 'GENERAL',
    "dailyServiceId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Ward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "wardId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admission" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "patientId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "encounterId" UUID,
    "wardId" UUID,
    "cageId" UUID,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'ADMITTED',
    "condition" "PatientCondition" NOT NULL DEFAULT 'STABLE',
    "cprStatus" "CprStatus" NOT NULL DEFAULT 'UNDECIDED',
    "reason" TEXT NOT NULL,
    "diagnosis" TEXT,
    "isolation" BOOLEAN NOT NULL DEFAULT false,
    "feedingInstructions" TEXT,
    "responsibleClinicianId" UUID,
    "expectedDischargeAt" TIMESTAMPTZ(3),
    "admittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "admittedById" UUID NOT NULL,
    "admittedByName" TEXT NOT NULL,
    "dischargedAt" TIMESTAMPTZ(3),
    "dischargedById" UUID,
    "dischargedByName" TEXT,
    "outcome" "AdmissionOutcome",
    "dischargeSummary" TEXT,
    "homeCareInstructions" TEXT,
    "followUpAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Admission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentOrder" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "admissionId" UUID NOT NULL,
    "kind" "TreatmentKind" NOT NULL,
    "schedule" "TreatmentSchedule" NOT NULL DEFAULT 'INTERVAL',
    "description" TEXT NOT NULL,
    "productId" UUID,
    "dose" DECIMAL(14,4),
    "doseUnit" TEXT,
    "route" TEXT,
    "fluidRateMlPerHour" DECIMAL(10,2),
    "intervalHours" INTEGER,
    "instructions" TEXT,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3),
    "status" "TreatmentOrderStatus" NOT NULL DEFAULT 'ACTIVE',
    "orderedById" UUID NOT NULL,
    "orderedByName" TEXT NOT NULL,
    "stoppedAt" TIMESTAMPTZ(3),
    "stoppedByName" TEXT,
    "stopReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreatmentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentTask" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "admissionId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "TreatmentTaskStatus" NOT NULL DEFAULT 'DUE',
    "doneAt" TIMESTAMPTZ(3),
    "doneById" UUID,
    "doneByName" TEXT,
    "value" TEXT,
    "notes" TEXT,
    "skipReason" TEXT,
    "administrationId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreatmentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HospitalNote" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "admissionId" UUID NOT NULL,
    "type" "HospitalNoteType" NOT NULL DEFAULT 'PROGRESS',
    "text" TEXT NOT NULL,
    "authorId" UUID NOT NULL,
    "authorName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HospitalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Surgery" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "patientId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "appointmentId" UUID,
    "admissionId" UUID,
    "encounterId" UUID,
    "procedure" TEXT NOT NULL,
    "serviceId" UUID,
    "theatreId" UUID,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "priority" "SurgeryPriority" NOT NULL DEFAULT 'ELECTIVE',
    "status" "SurgeryStatus" NOT NULL DEFAULT 'SCHEDULED',
    "asaGrade" "AsaGrade",
    "asaEmergency" BOOLEAN NOT NULL DEFAULT false,
    "preOpAssessment" TEXT,
    "fastingConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "consentObtained" BOOLEAN NOT NULL DEFAULT false,
    "consentGivenBy" TEXT,
    "consentAt" TIMESTAMPTZ(3),
    "consentRecordedBy" TEXT,
    "estimateMinor" INTEGER,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "anaesthesiaPlan" TEXT,
    "airway" TEXT,
    "anaesthesiaStartAt" TIMESTAMPTZ(3),
    "anaesthesiaEndAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "recoveryStartedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "completedById" UUID,
    "completedByName" TEXT,
    "surgicalNotes" TEXT,
    "findings" TEXT,
    "complications" TEXT,
    "postOpInstructions" TEXT,
    "followUpAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Surgery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurgeryTeamMember" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "surgeryId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "role" "SurgeryRole" NOT NULL,

    CONSTRAINT "SurgeryTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnaesthesiaReading" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "surgeryId" UUID NOT NULL,
    "phase" "ReadingPhase" NOT NULL DEFAULT 'INTRA_OP',
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartRate" INTEGER,
    "respiratoryRate" INTEGER,
    "spo2" INTEGER,
    "etco2" INTEGER,
    "systolicBp" INTEGER,
    "diastolicBp" INTEGER,
    "meanBp" INTEGER,
    "temperatureC" DECIMAL(4,1),
    "agentPercent" DECIMAL(4,2),
    "oxygenLpm" DECIMAL(5,2),
    "painScore" INTEGER,
    "notes" TEXT,
    "recordedById" UUID NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnaesthesiaReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurgeryItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "surgeryId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "notes" TEXT,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurgeryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurgeryAddendum" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "surgeryId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "authorId" UUID NOT NULL,
    "authorName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurgeryAddendum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurgeryChecklistItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "phase" "ChecklistPhase" NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurgeryChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ward_organizationId_branchId_name_key" ON "Ward"("organizationId", "branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Cage_wardId_name_key" ON "Cage"("wardId", "name");

-- CreateIndex
CREATE INDEX "Admission_organizationId_status_branchId_idx" ON "Admission"("organizationId", "status", "branchId");

-- CreateIndex
CREATE INDEX "Admission_patientId_admittedAt_idx" ON "Admission"("patientId", "admittedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Admission_organizationId_number_key" ON "Admission"("organizationId", "number");

-- CreateIndex
CREATE INDEX "TreatmentOrder_admissionId_status_idx" ON "TreatmentOrder"("admissionId", "status");

-- CreateIndex
CREATE INDEX "TreatmentTask_admissionId_dueAt_idx" ON "TreatmentTask"("admissionId", "dueAt");

-- CreateIndex
CREATE INDEX "TreatmentTask_organizationId_status_dueAt_idx" ON "TreatmentTask"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "TreatmentTask_orderId_dueAt_key" ON "TreatmentTask"("orderId", "dueAt");

-- CreateIndex
CREATE INDEX "HospitalNote_admissionId_createdAt_idx" ON "HospitalNote"("admissionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Surgery_appointmentId_key" ON "Surgery"("appointmentId");

-- CreateIndex
CREATE INDEX "Surgery_organizationId_branchId_scheduledAt_idx" ON "Surgery"("organizationId", "branchId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Surgery_patientId_scheduledAt_idx" ON "Surgery"("patientId", "scheduledAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Surgery_organizationId_number_key" ON "Surgery"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SurgeryTeamMember_surgeryId_membershipId_role_key" ON "SurgeryTeamMember"("surgeryId", "membershipId", "role");

-- CreateIndex
CREATE INDEX "AnaesthesiaReading_surgeryId_recordedAt_idx" ON "AnaesthesiaReading"("surgeryId", "recordedAt");

-- CreateIndex
CREATE INDEX "SurgeryItem_surgeryId_idx" ON "SurgeryItem"("surgeryId");

-- CreateIndex
CREATE INDEX "SurgeryAddendum_surgeryId_idx" ON "SurgeryAddendum"("surgeryId");

-- CreateIndex
CREATE INDEX "SurgeryChecklistItem_organizationId_phase_idx" ON "SurgeryChecklistItem"("organizationId", "phase");

-- AddForeignKey
ALTER TABLE "Ward" ADD CONSTRAINT "Ward_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ward" ADD CONSTRAINT "Ward_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ward" ADD CONSTRAINT "Ward_dailyServiceId_fkey" FOREIGN KEY ("dailyServiceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cage" ADD CONSTRAINT "Cage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cage" ADD CONSTRAINT "Cage_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_cageId_fkey" FOREIGN KEY ("cageId") REFERENCES "Cage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_responsibleClinicianId_fkey" FOREIGN KEY ("responsibleClinicianId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentOrder" ADD CONSTRAINT "TreatmentOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentOrder" ADD CONSTRAINT "TreatmentOrder_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentOrder" ADD CONSTRAINT "TreatmentOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentTask" ADD CONSTRAINT "TreatmentTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentTask" ADD CONSTRAINT "TreatmentTask_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentTask" ADD CONSTRAINT "TreatmentTask_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TreatmentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalNote" ADD CONSTRAINT "HospitalNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalNote" ADD CONSTRAINT "HospitalNote_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Surgery" ADD CONSTRAINT "Surgery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Surgery" ADD CONSTRAINT "Surgery_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Surgery" ADD CONSTRAINT "Surgery_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Surgery" ADD CONSTRAINT "Surgery_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Surgery" ADD CONSTRAINT "Surgery_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Surgery" ADD CONSTRAINT "Surgery_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Surgery" ADD CONSTRAINT "Surgery_theatreId_fkey" FOREIGN KEY ("theatreId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryTeamMember" ADD CONSTRAINT "SurgeryTeamMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryTeamMember" ADD CONSTRAINT "SurgeryTeamMember_surgeryId_fkey" FOREIGN KEY ("surgeryId") REFERENCES "Surgery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryTeamMember" ADD CONSTRAINT "SurgeryTeamMember_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnaesthesiaReading" ADD CONSTRAINT "AnaesthesiaReading_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnaesthesiaReading" ADD CONSTRAINT "AnaesthesiaReading_surgeryId_fkey" FOREIGN KEY ("surgeryId") REFERENCES "Surgery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryItem" ADD CONSTRAINT "SurgeryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryItem" ADD CONSTRAINT "SurgeryItem_surgeryId_fkey" FOREIGN KEY ("surgeryId") REFERENCES "Surgery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryItem" ADD CONSTRAINT "SurgeryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryAddendum" ADD CONSTRAINT "SurgeryAddendum_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryAddendum" ADD CONSTRAINT "SurgeryAddendum_surgeryId_fkey" FOREIGN KEY ("surgeryId") REFERENCES "Surgery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryChecklistItem" ADD CONSTRAINT "SurgeryChecklistItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Integrity rules not expressible in Prisma ──
CREATE INDEX "VitalSign_admissionId_idx" ON "VitalSign"("admissionId");

-- One active stay per patient, and one patient per cage.
CREATE UNIQUE INDEX "Admission_one_active_per_patient" ON "Admission"("patientId") WHERE "status" = 'ADMITTED';
CREATE UNIQUE INDEX "Admission_one_active_per_cage" ON "Admission"("cageId") WHERE "status" = 'ADMITTED' AND "cageId" IS NOT NULL;

ALTER TABLE "TreatmentOrder" ADD CONSTRAINT "TreatmentOrder_interval_positive" CHECK ("intervalHours" IS NULL OR "intervalHours" BETWEEN 1 AND 168);
ALTER TABLE "TreatmentOrder" ADD CONSTRAINT "TreatmentOrder_dose_positive" CHECK ("dose" IS NULL OR "dose" > 0);
ALTER TABLE "SurgeryItem" ADD CONSTRAINT "SurgeryItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "Surgery" ADD CONSTRAINT "Surgery_duration_positive" CHECK ("durationMinutes" > 0);

-- Discharged admissions are final: only re-pointing patient/client during a merge is allowed.
CREATE OR REPLACE FUNCTION admission_lock() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('DISCHARGED', 'CANCELLED') THEN
    IF (to_jsonb(NEW) - 'patientId' - 'clientId' - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'patientId' - 'clientId' - 'updatedAt') THEN
      RAISE EXCEPTION 'Discharged or cancelled admissions cannot be changed';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER admission_lock BEFORE UPDATE ON "Admission" FOR EACH ROW EXECUTE FUNCTION admission_lock();

-- Completed surgical records are locked; corrections are addenda.
CREATE OR REPLACE FUNCTION surgery_lock() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('COMPLETED', 'CANCELLED') THEN
    IF (to_jsonb(NEW) - 'patientId' - 'clientId' - 'admissionId' - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'patientId' - 'clientId' - 'admissionId' - 'updatedAt') THEN
      RAISE EXCEPTION 'Completed surgical records are locked; add an addendum instead';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER surgery_lock BEFORE UPDATE ON "Surgery" FOR EACH ROW EXECUTE FUNCTION surgery_lock();
CREATE OR REPLACE FUNCTION surgery_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Surgical records cannot be deleted';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER surgery_no_delete BEFORE DELETE ON "Surgery" FOR EACH ROW EXECUTE FUNCTION surgery_no_delete();

-- Monitoring readings, hospital notes, surgery consumables and addenda are append-only.
CREATE OR REPLACE FUNCTION append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER anaesthesia_reading_append_only BEFORE UPDATE OR DELETE ON "AnaesthesiaReading" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER hospital_note_append_only BEFORE UPDATE OR DELETE ON "HospitalNote" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER surgery_item_append_only BEFORE UPDATE OR DELETE ON "SurgeryItem" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER surgery_addendum_append_only BEFORE UPDATE OR DELETE ON "SurgeryAddendum" FOR EACH ROW EXECUTE FUNCTION append_only();

-- A completed treatment task is a clinical record: it cannot be changed or deleted.
CREATE OR REPLACE FUNCTION treatment_task_lock() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Treatment tasks cannot be deleted';
  END IF;
  IF OLD."status" IN ('DONE', 'SKIPPED') THEN
    RAISE EXCEPTION 'Recorded treatments cannot be changed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER treatment_task_lock BEFORE UPDATE OR DELETE ON "TreatmentTask" FOR EACH ROW EXECUTE FUNCTION treatment_task_lock();
