-- Appointment types and consultation templates become one thing: each type can carry the template (questions,
-- examination, diagnoses, advice) the vet uses for that kind of visit.
ALTER TABLE "AppointmentType" ADD COLUMN "templateId" UUID;
ALTER TABLE "AppointmentType" ADD CONSTRAINT "AppointmentType_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ClinicalTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A type with the same name as a template gets that template.
UPDATE "AppointmentType" t
SET "templateId" = ct."id", "updatedAt" = now()
FROM "ClinicalTemplate" ct
WHERE ct."organizationId" = t."organizationId" AND lower(ct."name") = lower(t."name") AND t."templateId" IS NULL;

-- The starter templates whose type has another name: "General consultation" → "Consultation", "Recheck / follow-up" → "Follow-up".
UPDATE "AppointmentType" t
SET "templateId" = ct."id", "updatedAt" = now()
FROM "ClinicalTemplate" ct
WHERE ct."organizationId" = t."organizationId" AND t."templateId" IS NULL
  AND ((lower(ct."name") = 'general consultation' AND lower(t."name") = 'consultation') OR (lower(ct."name") = 'recheck / follow-up' AND lower(t."name") = 'follow-up'))
  AND NOT EXISTS (SELECT 1 FROM "AppointmentType" x WHERE x."templateId" = ct."id");

-- Every other template becomes an appointment type in the clinic's Consultation category, charged like the clinic's
-- consultation (same service), so it can be booked and chosen in the first step of a consultation.
INSERT INTO "AppointmentType" ("id", "organizationId", "name", "category", "categoryId", "durationMinutes", "color", "serviceId", "requiresClinician", "allowOnlineBooking", "isActive", "templateId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), ct."organizationId", ct."name", 'CONSULTATION',
  (SELECT c."id" FROM "AppointmentTypeCategory" c WHERE c."organizationId" = ct."organizationId" AND c."kind" = 'CONSULTATION' ORDER BY c."isActive" DESC, c."sortOrder", c."name" LIMIT 1),
  15, '#0d7a70',
  (SELECT a."serviceId" FROM "AppointmentType" a WHERE a."organizationId" = ct."organizationId" AND a."category" = 'CONSULTATION' AND a."serviceId" IS NOT NULL ORDER BY (lower(a."name") = 'consultation') DESC, a."isActive" DESC, a."createdAt" LIMIT 1),
  true, false, ct."isActive", ct."id", now(), now()
FROM "ClinicalTemplate" ct
WHERE NOT EXISTS (SELECT 1 FROM "AppointmentType" t WHERE t."templateId" = ct."id")
  AND NOT EXISTS (SELECT 1 FROM "AppointmentType" t WHERE t."organizationId" = ct."organizationId" AND lower(t."name") = lower(ct."name"));
