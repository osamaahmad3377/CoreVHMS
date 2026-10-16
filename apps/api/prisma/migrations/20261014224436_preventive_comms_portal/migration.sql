-- CreateEnum
CREATE TYPE "CareKind" AS ENUM ('VACCINATION', 'DEWORMING', 'PARASITE_PREVENTION', 'HEALTH_CHECK', 'DENTAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CareProtocolStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "CareItemStatus" AS ENUM ('DUE', 'COMPLETED', 'CANCELLED', 'DEFERRED');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "PortalUserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "PortalTokenType" AS ENUM ('INVITE', 'RESET');

-- CreateEnum
CREATE TYPE "AppointmentRequestStatus" AS ENUM ('PENDING', 'BOOKED', 'DECLINED', 'CANCELLED');

-- DropIndex
DROP INDEX "VitalSign_admissionId_idx";

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "reminderSentAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "sharedAt" TIMESTAMPTZ(3),
ADD COLUMN     "sharedByName" TEXT,
ADD COLUMN     "sharedWithClient" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "appointmentReminderHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "overdueReminderDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "portalCancelHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "portalEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reminderLeadDays" INTEGER NOT NULL DEFAULT 14;

-- CreateTable
CREATE TABLE "CareProtocol" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CareKind" NOT NULL,
    "speciesId" UUID,
    "productId" UUID,
    "firstDueAgeWeeks" INTEGER,
    "intervalDays" INTEGER,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "status" "CareProtocolStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CareProtocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "protocolId" UUID,
    "kind" "CareKind" NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "CareItemStatus" NOT NULL DEFAULT 'DUE',
    "deferredUntil" DATE,
    "deferReason" TEXT,
    "cancelReason" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "completedByName" TEXT,
    "administrationId" UUID,
    "givenElsewhere" BOOLEAN NOT NULL DEFAULT false,
    "productName" TEXT,
    "batchNumber" TEXT,
    "notes" TEXT,
    "previousItemId" UUID,
    "remindedAt" TIMESTAMPTZ(3),
    "overdueRemindedAt" TIMESTAMPTZ(3),
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CareItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "clientId" UUID,
    "patientId" UUID,
    "channel" "MessageChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "dedupeKey" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientMessage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "patientId" UUID,
    "direction" "MessageDirection" NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'MESSAGE',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "staffUserId" UUID,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalUser" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "status" "PortalUserStatus" NOT NULL DEFAULT 'INVITED',
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PortalUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalAccess" (
    "id" UUID NOT NULL,
    "portalUserId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "invitedByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalSession" (
    "id" UUID NOT NULL,
    "portalUserId" UUID NOT NULL,
    "accessId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalToken" (
    "id" UUID NOT NULL,
    "portalUserId" UUID NOT NULL,
    "type" "PortalTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentRequest" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "patientId" UUID,
    "reason" TEXT NOT NULL,
    "preferredDate" DATE NOT NULL,
    "preferredTime" TEXT NOT NULL DEFAULT 'ANY',
    "notes" TEXT,
    "status" "AppointmentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "appointmentId" UUID,
    "handledByName" TEXT,
    "handledAt" TIMESTAMPTZ(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AppointmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareProtocol_organizationId_status_idx" ON "CareProtocol"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CareItem_administrationId_key" ON "CareItem"("administrationId");

-- CreateIndex
CREATE INDEX "CareItem_organizationId_status_dueDate_idx" ON "CareItem"("organizationId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "CareItem_patientId_dueDate_idx" ON "CareItem"("patientId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_organizationId_purpose_channel_key" ON "MessageTemplate"("organizationId", "purpose", "channel");

-- CreateIndex
CREATE INDEX "OutboundMessage_status_nextAttemptAt_idx" ON "OutboundMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_organizationId_clientId_createdAt_idx" ON "OutboundMessage"("organizationId", "clientId", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_organizationId_createdAt_idx" ON "OutboundMessage"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_organizationId_dedupeKey_key" ON "OutboundMessage"("organizationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ClientMessage_organizationId_clientId_createdAt_idx" ON "ClientMessage"("organizationId", "clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientMessage_organizationId_direction_readAt_idx" ON "ClientMessage"("organizationId", "direction", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "PortalUser_email_key" ON "PortalUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PortalAccess_organizationId_clientId_key" ON "PortalAccess"("organizationId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalAccess_portalUserId_organizationId_key" ON "PortalAccess"("portalUserId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalSession_tokenHash_key" ON "PortalSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PortalSession_portalUserId_idx" ON "PortalSession"("portalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalToken_tokenHash_key" ON "PortalToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PortalToken_portalUserId_type_idx" ON "PortalToken"("portalUserId", "type");

-- CreateIndex
CREATE INDEX "AppointmentRequest_organizationId_status_createdAt_idx" ON "AppointmentRequest"("organizationId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "CareProtocol" ADD CONSTRAINT "CareProtocol_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareProtocol" ADD CONSTRAINT "CareProtocol_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "Species"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareProtocol" ADD CONSTRAINT "CareProtocol_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareItem" ADD CONSTRAINT "CareItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareItem" ADD CONSTRAINT "CareItem_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareItem" ADD CONSTRAINT "CareItem_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "CareProtocol"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMessage" ADD CONSTRAINT "ClientMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMessage" ADD CONSTRAINT "ClientMessage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAccess" ADD CONSTRAINT "PortalAccess_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "PortalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAccess" ADD CONSTRAINT "PortalAccess_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAccess" ADD CONSTRAINT "PortalAccess_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalSession" ADD CONSTRAINT "PortalSession_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "PortalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalToken" ADD CONSTRAINT "PortalToken_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "PortalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Integrity rules not expressible in Prisma ──
-- At most one open (due or deferred) care item per patient and protocol, so reminders and schedules never double up.
CREATE UNIQUE INDEX "CareItem_one_open_per_protocol" ON "CareItem"("patientId", "protocolId") WHERE "status" IN ('DUE', 'DEFERRED') AND "protocolId" IS NOT NULL;
ALTER TABLE "CareProtocol" ADD CONSTRAINT "CareProtocol_interval_positive" CHECK ("intervalDays" IS NULL OR "intervalDays" > 0);
ALTER TABLE "CareProtocol" ADD CONSTRAINT "CareProtocol_age_positive" CHECK ("firstDueAgeWeeks" IS NULL OR "firstDueAgeWeeks" >= 0);
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_attempts_nonneg" CHECK ("attempts" >= 0);
CREATE INDEX "PortalAccess_portalUserId_idx" ON "PortalAccess"("portalUserId");

-- Completed care items are clinical records: they cannot be changed (except re-pointing the patient in a merge) or deleted.
CREATE OR REPLACE FUNCTION care_item_lock() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Care items cannot be deleted; cancel them instead';
  END IF;
  IF OLD."status" = 'COMPLETED' AND (to_jsonb(NEW) - 'patientId' - 'updatedAt' - 'remindedAt' - 'overdueRemindedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'patientId' - 'updatedAt' - 'remindedAt' - 'overdueRemindedAt') THEN
    RAISE EXCEPTION 'Completed care items cannot be changed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER care_item_lock BEFORE UPDATE OR DELETE ON "CareItem" FOR EACH ROW EXECUTE FUNCTION care_item_lock();

-- Client messages are a correspondence record: only the read receipt may change.
CREATE OR REPLACE FUNCTION client_message_lock() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Client messages cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - 'readAt' - 'clientId' - 'patientId') IS DISTINCT FROM (to_jsonb(OLD) - 'readAt' - 'clientId' - 'patientId') THEN
    RAISE EXCEPTION 'Client messages cannot be edited';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER client_message_lock BEFORE UPDATE OR DELETE ON "ClientMessage" FOR EACH ROW EXECUTE FUNCTION client_message_lock();
