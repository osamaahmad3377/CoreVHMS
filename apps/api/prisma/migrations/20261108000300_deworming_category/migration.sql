-- A "Deworming" appointment category for every clinic that does not have one (new clinics get it from the start).
-- It works like Vaccination: preventive care, offered on the waiting-room screen.
INSERT INTO "AppointmentTypeCategory" ("id", "organizationId", "name", "kind", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", 'Deworming', 'VACCINATION', 25, true, now(), now()
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "AppointmentTypeCategory" c WHERE c."organizationId" = o."id" AND lower(c."name") = 'deworming');

-- The starter "Deworming" appointment type moves out of "Other" into it.
UPDATE "AppointmentType" t
SET "categoryId" = c."id", "category" = 'VACCINATION', "updatedAt" = now()
FROM "AppointmentTypeCategory" c
WHERE c."organizationId" = t."organizationId" AND lower(c."name") = 'deworming'
  AND lower(t."name") = 'deworming' AND t."category" = 'OTHER';
