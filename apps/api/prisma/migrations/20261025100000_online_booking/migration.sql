-- Online booking page: per-clinic settings, and a private change/cancel link on appointments booked online.
-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "manageTokenHash" TEXT;

-- CreateTable
CREATE TABLE "OnlineBookingSettings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT NOT NULL,
    "daysAhead" INTEGER NOT NULL DEFAULT 30,
    "minNoticeHours" INTEGER NOT NULL DEFAULT 2,
    "branchIds" UUID[],
    "clinicianIds" UUID[],
    "allowNewClients" BOOLEAN NOT NULL DEFAULT true,
    "autoConfirm" BOOLEAN NOT NULL DEFAULT false,
    "welcomeMessage" TEXT,
    "cancelNoticeHours" INTEGER NOT NULL DEFAULT 4,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OnlineBookingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnlineBookingSettings_organizationId_key" ON "OnlineBookingSettings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OnlineBookingSettings_slug_key" ON "OnlineBookingSettings"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_manageTokenHash_key" ON "Appointment"("manageTokenHash");

-- AddForeignKey
ALTER TABLE "OnlineBookingSettings" ADD CONSTRAINT "OnlineBookingSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "OnlineBookingSettings" ADD CONSTRAINT "OnlineBookingSettings_limits" CHECK ("daysAhead" BETWEEN 1 AND 365 AND "minNoticeHours" BETWEEN 0 AND 336 AND "cancelNoticeHours" BETWEEN 0 AND 336 AND "slug" ~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$');
