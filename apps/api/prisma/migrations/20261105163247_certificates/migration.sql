-- CreateEnum
CREATE TYPE "CertificateKind" AS ENUM ('VACCINATION', 'RABIES_VACCINATION', 'HEALTH', 'FITNESS_TO_TRAVEL', 'FITNESS', 'MICROCHIP', 'STERILISATION', 'DEATH', 'BREEDING_SOUNDNESS', 'LIVESTOCK_HEALTH', 'PATIENT_CUSTOM', 'EMPLOYMENT', 'EXPERIENCE', 'TRAINING', 'CPD', 'APPRECIATION', 'STAFF_CUSTOM');

-- CreateEnum
CREATE TYPE "CertificateSubject" AS ENUM ('PATIENT', 'STAFF');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('ISSUED', 'REVOKED');

-- CreateTable
CREATE TABLE "CertificateTemplate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "CertificateKind" NOT NULL,
    "name" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByName" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CertificateTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID,
    "number" INTEGER NOT NULL,
    "kind" "CertificateKind" NOT NULL,
    "subject" "CertificateSubject" NOT NULL,
    "templateId" UUID,
    "templateName" TEXT NOT NULL,
    "patientId" UUID,
    "clientId" UUID,
    "membershipId" UUID,
    "encounterId" UUID,
    "subjectName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "data" JSONB NOT NULL,
    "layout" JSONB NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" DATE,
    "issuedById" UUID NOT NULL,
    "issuedByName" TEXT NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'ISSUED',
    "revokedAt" TIMESTAMPTZ(3),
    "revokedByName" TEXT,
    "revokedReason" TEXT,
    "replacesId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CertificateTemplate_organizationId_kind_idx" ON "CertificateTemplate"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_verificationCode_key" ON "Certificate"("verificationCode");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_replacesId_key" ON "Certificate"("replacesId");

-- CreateIndex
CREATE INDEX "Certificate_organizationId_issuedAt_idx" ON "Certificate"("organizationId", "issuedAt");

-- CreateIndex
CREATE INDEX "Certificate_patientId_idx" ON "Certificate"("patientId");

-- CreateIndex
CREATE INDEX "Certificate_membershipId_idx" ON "Certificate"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_organizationId_number_key" ON "Certificate"("organizationId", "number");

-- AddForeignKey
ALTER TABLE "CertificateTemplate" ADD CONSTRAINT "CertificateTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CertificateTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One default template per kind of certificate.
CREATE UNIQUE INDEX "CertificateTemplate_one_default" ON "CertificateTemplate" ("organizationId", "kind") WHERE "isDefault";

-- A certificate is for a patient or for a member of staff, matching its subject.
ALTER TABLE "Certificate" ADD CONSTRAINT "certificate_subject_matches" CHECK (
  ("subject" = 'PATIENT' AND "patientId" IS NOT NULL AND "membershipId" IS NULL)
  OR ("subject" = 'STAFF' AND "membershipId" IS NOT NULL AND "patientId" IS NULL)
);
-- A revoked certificate says when, by whom and why.
ALTER TABLE "Certificate" ADD CONSTRAINT "certificate_revocation_complete" CHECK (
  "status" = 'ISSUED' OR ("revokedAt" IS NOT NULL AND "revokedByName" IS NOT NULL AND "revokedReason" IS NOT NULL)
);

-- Issued certificates are permanent. The only changes: revoking one (once), and re-pointing it to the surviving
-- patient or client after a merge. They are never deleted.
CREATE OR REPLACE FUNCTION certificate_lock() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Certificates are permanent; revoke it instead';
  END IF;
  IF OLD."status" = 'REVOKED' AND (NEW."status" IS DISTINCT FROM OLD."status" OR NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt"
      OR NEW."revokedByName" IS DISTINCT FROM OLD."revokedByName" OR NEW."revokedReason" IS DISTINCT FROM OLD."revokedReason") THEN
    RAISE EXCEPTION 'A revoked certificate stays revoked';
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."branchId" IS DISTINCT FROM OLD."branchId"
     OR NEW."number" IS DISTINCT FROM OLD."number"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."subject" IS DISTINCT FROM OLD."subject"
     OR NEW."templateName" IS DISTINCT FROM OLD."templateName"
     OR NEW."membershipId" IS DISTINCT FROM OLD."membershipId"
     OR NEW."encounterId" IS DISTINCT FROM OLD."encounterId"
     OR NEW."subjectName" IS DISTINCT FROM OLD."subjectName"
     OR NEW."title" IS DISTINCT FROM OLD."title"
     OR NEW."inputs"::text IS DISTINCT FROM OLD."inputs"::text
     OR NEW."data"::text IS DISTINCT FROM OLD."data"::text
     OR NEW."layout"::text IS DISTINCT FROM OLD."layout"::text
     OR NEW."verificationCode" IS DISTINCT FROM OLD."verificationCode"
     OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
     OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt"
     OR NEW."validUntil" IS DISTINCT FROM OLD."validUntil"
     OR NEW."issuedById" IS DISTINCT FROM OLD."issuedById"
     OR NEW."issuedByName" IS DISTINCT FROM OLD."issuedByName"
     OR NEW."replacesId" IS DISTINCT FROM OLD."replacesId" THEN
    RAISE EXCEPTION 'Issued certificates cannot be changed; revoke it and issue a new one';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER certificate_lock BEFORE UPDATE OR DELETE ON "Certificate" FOR EACH ROW EXECUTE FUNCTION certificate_lock();

-- ── Permissions for existing clinics' system roles (same as new clinics get) ──
INSERT INTO "RolePermission" ("roleId", "permission")
SELECT r.id, p.permission FROM "Role" r
CROSS JOIN (VALUES ('certificates.read'), ('certificates.issue'), ('certificates.staff'), ('certificates.templates')) AS p(permission)
WHERE r."isSystem" AND r."key" IN ('owner', 'practice_manager')
ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permission")
SELECT r.id, p.permission FROM "Role" r
CROSS JOIN (VALUES ('certificates.read'), ('certificates.issue')) AS p(permission)
WHERE r."isSystem" AND r."key" IN ('veterinarian', 'surgeon', 'field_vet')
ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permission")
SELECT r.id, 'certificates.read' FROM "Role" r
WHERE r."isSystem" AND r."key" IN ('nurse', 'receptionist')
ON CONFLICT DO NOTHING;
