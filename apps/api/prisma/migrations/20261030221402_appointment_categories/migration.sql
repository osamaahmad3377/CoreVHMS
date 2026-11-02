-- AlterTable
ALTER TABLE "AppointmentType" ADD COLUMN     "categoryId" UUID;

-- CreateTable
CREATE TABLE "AppointmentTypeCategory" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AppointmentCategory" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AppointmentTypeCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppointmentTypeCategory_organizationId_isActive_sortOrder_idx" ON "AppointmentTypeCategory"("organizationId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentTypeCategory_organizationId_name_key" ON "AppointmentTypeCategory"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "AppointmentType" ADD CONSTRAINT "AppointmentType_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AppointmentTypeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentTypeCategory" ADD CONSTRAINT "AppointmentTypeCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every clinic starts with the ten built-in categories (it can rename, hide or add its own) …
INSERT INTO "AppointmentTypeCategory" ("id", "organizationId", "name", "kind", "sortOrder", "updatedAt")
SELECT gen_random_uuid(), o."id", d."name", d."kind"::"AppointmentCategory", d."sort", now()
FROM "Organization" o
CROSS JOIN (VALUES
  ('Consultation', 'CONSULTATION', 10), ('Vaccination', 'VACCINATION', 20), ('Follow-up', 'FOLLOW_UP', 30),
  ('Surgery', 'SURGERY', 40), ('Dental', 'DENTAL', 50), ('Diagnostics', 'DIAGNOSTICS', 60),
  ('Grooming', 'GROOMING', 70), ('Emergency', 'EMERGENCY', 80), ('Field visit', 'FIELD_VISIT', 90), ('Other', 'OTHER', 100)
) AS d("name", "kind", "sort")
ON CONFLICT ("organizationId", "name") DO NOTHING;

-- … and its appointment types are linked to the category of their kind.
UPDATE "AppointmentType" t SET "categoryId" = c."id"
FROM "AppointmentTypeCategory" c
WHERE c."organizationId" = t."organizationId" AND c."kind" = t."category" AND t."categoryId" IS NULL
  AND c."name" IN ('Consultation', 'Vaccination', 'Follow-up', 'Surgery', 'Dental', 'Diagnostics', 'Grooming', 'Emergency', 'Field visit', 'Other');
