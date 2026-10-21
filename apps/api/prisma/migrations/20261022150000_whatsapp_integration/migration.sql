-- A clinic's own WhatsApp Business number (Meta Cloud API), template links, and delivery receipts on sent messages.
-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "deliveredAt" TIMESTAMPTZ(3),
ADD COLUMN     "readAt" TIMESTAMPTZ(3),
ADD COLUMN     "templateVars" JSONB;

-- CreateTable
CREATE TABLE "WhatsAppIntegration" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "phoneNumberId" TEXT NOT NULL,
    "businessAccountId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "appSecretEnc" TEXT,
    "webhookKey" TEXT NOT NULL,
    "verifyToken" TEXT NOT NULL,
    "displayPhoneNumber" TEXT,
    "verifiedName" TEXT,
    "qualityRating" TEXT,
    "sendPolicy" TEXT NOT NULL DEFAULT 'PREFERRED',
    "fallbackToEmail" BOOLEAN NOT NULL DEFAULT true,
    "connectedByName" TEXT,
    "lastVerifiedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "lastWebhookAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhatsAppIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppTemplateLink" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "params" TEXT[],
    "updatedByName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplateLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppIntegration_organizationId_key" ON "WhatsAppIntegration"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppIntegration_webhookKey_key" ON "WhatsAppIntegration"("webhookKey");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplateLink_organizationId_purpose_key" ON "WhatsAppTemplateLink"("organizationId", "purpose");

-- CreateIndex
CREATE INDEX "OutboundMessage_providerMessageId_idx" ON "OutboundMessage"("providerMessageId");

-- AddForeignKey
ALTER TABLE "WhatsAppIntegration" ADD CONSTRAINT "WhatsAppIntegration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppTemplateLink" ADD CONSTRAINT "WhatsAppTemplateLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Only sensible sending rules.
ALTER TABLE "WhatsAppIntegration" ADD CONSTRAINT "WhatsAppIntegration_sendPolicy_check" CHECK ("sendPolicy" IN ('PREFERRED', 'ALL_MOBILE'));
