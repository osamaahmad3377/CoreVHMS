-- CreateEnum
CREATE TYPE "VisitLocation" AS ENUM ('CLINIC', 'HOME');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "arrivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "distanceKm" DECIMAL(8,1),
ADD COLUMN     "location" "VisitLocation" NOT NULL DEFAULT 'CLINIC',
ADD COLUMN     "onTheWayAt" TIMESTAMPTZ(3),
ADD COLUMN     "travelStartsAt" TIMESTAMPTZ(3),
ADD COLUMN     "visitAddress" TEXT,
ADD COLUMN     "visitDirections" TEXT,
ADD COLUMN     "visitMapUrl" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "homeVisitCalloutServiceId" UUID,
ADD COLUMN     "homeVisitPerKmServiceId" UUID,
ADD COLUMN     "homeVisitTravelMinutes" INTEGER NOT NULL DEFAULT 30;

-- CreateIndex
CREATE INDEX "Appointment_organizationId_location_startsAt_idx" ON "Appointment"("organizationId", "location", "startsAt");

-- A home visit has an address; travel starts before the visit; distance is never negative.
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_home_visit_address" CHECK ("location" <> 'HOME' OR "visitAddress" IS NOT NULL);
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_travel_before_start" CHECK ("travelStartsAt" IS NULL OR "travelStartsAt" <= "startsAt");
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_distance_valid" CHECK ("distanceKm" IS NULL OR "distanceKm" >= 0);
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_home_visit_travel_valid" CHECK ("homeVisitTravelMinutes" BETWEEN 0 AND 240);

-- Double-booking protection now covers a home visit's travel time: the vet is busy from when they set off.
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_clinician_no_overlap";
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinician_no_overlap"
  EXCLUDE USING gist ("clinicianId" WITH =, tstzrange(COALESCE("travelStartsAt", "startsAt"), "endsAt", '[)') WITH &&)
  WHERE ("clinicianId" IS NOT NULL AND "isOverbooked" = false AND status NOT IN ('CANCELLED', 'NO_SHOW'));
