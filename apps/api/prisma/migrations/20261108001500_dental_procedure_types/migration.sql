-- AlterTable
ALTER TABLE "AppointmentType" ADD COLUMN     "dentalProcedureCode" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "dentalProcedureTypesSeeded" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentType_organizationId_dentalProcedureCode_key" ON "AppointmentType"("organizationId", "dentalProcedureCode");

