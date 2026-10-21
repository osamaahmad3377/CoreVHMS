-- Automatic client notifications (booking confirmed, results ready, discharged, payment received…): per-clinic channel choices.
-- CreateTable
CREATE TABLE "ClientNotificationRule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "whatsapp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClientNotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientNotificationRule_organizationId_event_key" ON "ClientNotificationRule"("organizationId", "event");

-- AddForeignKey
ALTER TABLE "ClientNotificationRule" ADD CONSTRAINT "ClientNotificationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

