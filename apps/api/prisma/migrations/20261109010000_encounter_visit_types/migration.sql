-- CreateTable
CREATE TABLE "EncounterVisitType" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "encounterId" UUID NOT NULL,
    "appointmentTypeId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncounterVisitType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EncounterVisitType_encounterId_appointmentTypeId_key" ON "EncounterVisitType"("encounterId", "appointmentTypeId");

-- AddForeignKey
ALTER TABLE "EncounterVisitType" ADD CONSTRAINT "EncounterVisitType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterVisitType" ADD CONSTRAINT "EncounterVisitType_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterVisitType" ADD CONSTRAINT "EncounterVisitType_appointmentTypeId_fkey" FOREIGN KEY ("appointmentTypeId") REFERENCES "AppointmentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

