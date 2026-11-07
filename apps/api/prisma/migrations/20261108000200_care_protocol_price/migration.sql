-- AlterTable
ALTER TABLE "CareProtocol" ADD COLUMN     "serviceId" UUID;

-- AddForeignKey
ALTER TABLE "CareProtocol" ADD CONSTRAINT "CareProtocol_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
