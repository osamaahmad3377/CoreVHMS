-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "extraTypeIds" UUID[] DEFAULT ARRAY[]::UUID[];

