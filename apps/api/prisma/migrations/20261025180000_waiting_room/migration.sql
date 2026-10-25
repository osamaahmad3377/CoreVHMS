-- Waiting room: daily token numbers, calling to a room, and per-branch TV screen / check-in tablet settings.
-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "callCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "calledAt" TIMESTAMPTZ(3),
ADD COLUMN     "calledByName" TEXT,
ADD COLUMN     "calledRoom" TEXT,
ADD COLUMN     "tokenDay" DATE,
ADD COLUMN     "tokenNumber" INTEGER;

-- CreateTable
CREATE TABLE "WaitingRoomSettings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "displayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "kioskEnabled" BOOLEAN NOT NULL DEFAULT true,
    "displayKey" TEXT NOT NULL,
    "kioskKey" TEXT NOT NULL,
    "showPetNames" BOOLEAN NOT NULL DEFAULT true,
    "kioskWalkIns" BOOLEAN NOT NULL DEFAULT true,
    "announce" BOOLEAN NOT NULL DEFAULT true,
    "message" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WaitingRoomSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaitingRoomSettings_branchId_key" ON "WaitingRoomSettings"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "WaitingRoomSettings_displayKey_key" ON "WaitingRoomSettings"("displayKey");

-- CreateIndex
CREATE UNIQUE INDEX "WaitingRoomSettings_kioskKey_key" ON "WaitingRoomSettings"("kioskKey");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_branchId_tokenDay_tokenNumber_key" ON "Appointment"("branchId", "tokenDay", "tokenNumber");

-- AddForeignKey
ALTER TABLE "WaitingRoomSettings" ADD CONSTRAINT "WaitingRoomSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitingRoomSettings" ADD CONSTRAINT "WaitingRoomSettings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

