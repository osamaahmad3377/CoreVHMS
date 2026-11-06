-- CreateEnum
CREATE TYPE "SerologyStatus" AS ENUM ('PLANNED', 'COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "SerologyOutcome" AS ENUM ('SATISFACTORY', 'UNSATISFACTORY');

-- CreateTable
CREATE TABLE "SerologyTest" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "status" "SerologyStatus" NOT NULL DEFAULT 'COMPLETED',
    "plannedFor" DATE,
    "sampleDate" DATE,
    "laboratory" TEXT,
    "reference" TEXT,
    "resultValue" DECIMAL(10,3),
    "resultUnit" TEXT NOT NULL DEFAULT 'IU/mL',
    "outcome" "SerologyOutcome",
    "validFrom" DATE,
    "validUntil" DATE,
    "notes" TEXT,
    "recordedById" UUID NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedByName" TEXT,
    "voidedReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SerologyTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SerologyTest_patientId_status_idx" ON "SerologyTest"("patientId", "status");

-- CreateIndex
CREATE INDEX "SerologyTest_organizationId_plannedFor_idx" ON "SerologyTest"("organizationId", "plannedFor");

-- AddForeignKey
ALTER TABLE "SerologyTest" ADD CONSTRAINT "SerologyTest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerologyTest" ADD CONSTRAINT "SerologyTest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A completed test has a sample date and a result; a planned one has a planned date; a voided one says why.
ALTER TABLE "SerologyTest" ADD CONSTRAINT "serology_complete" CHECK (
  ("status" = 'PLANNED' AND "plannedFor" IS NOT NULL)
  OR ("status" = 'COMPLETED' AND "sampleDate" IS NOT NULL AND "outcome" IS NOT NULL)
  OR ("status" = 'VOIDED' AND "voidedAt" IS NOT NULL AND "voidedByName" IS NOT NULL AND "voidedReason" IS NOT NULL)
);

-- Results are permanent: a planned test can be changed or completed; a completed one can only be voided;
-- nothing is deleted. After a patient merge the record may move to the surviving patient.
CREATE OR REPLACE FUNCTION serology_lock() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Test records are permanent; void it instead';
  END IF;
  IF OLD."status" = 'VOIDED' AND (NEW."status" IS DISTINCT FROM OLD."status" OR NEW."voidedReason" IS DISTINCT FROM OLD."voidedReason") THEN
    RAISE EXCEPTION 'A voided test stays voided';
  END IF;
  IF OLD."status" = 'COMPLETED' AND NEW."status" <> 'VOIDED' AND (
       NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."sampleDate" IS DISTINCT FROM OLD."sampleDate"
    OR NEW."laboratory" IS DISTINCT FROM OLD."laboratory"
    OR NEW."reference" IS DISTINCT FROM OLD."reference"
    OR NEW."resultValue" IS DISTINCT FROM OLD."resultValue"
    OR NEW."resultUnit" IS DISTINCT FROM OLD."resultUnit"
    OR NEW."outcome" IS DISTINCT FROM OLD."outcome"
    OR NEW."validFrom" IS DISTINCT FROM OLD."validFrom"
    OR NEW."validUntil" IS DISTINCT FROM OLD."validUntil"
    OR NEW."recordedById" IS DISTINCT FROM OLD."recordedById"
    OR NEW."recordedByName" IS DISTINCT FROM OLD."recordedByName") THEN
    RAISE EXCEPTION 'A recorded test result cannot be changed; void it and record it again';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER serology_lock BEFORE UPDATE OR DELETE ON "SerologyTest" FOR EACH ROW EXECUTE FUNCTION serology_lock();
