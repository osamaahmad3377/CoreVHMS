-- AlterTable
ALTER TABLE "NotePhrase" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- Clinics that already received the starter phrases get the normal answers marked too.
UPDATE "NotePhrase" p SET "isDefault" = true
FROM (VALUES
  ('subjective', 'Eating', 'Eating normally'), ('subjective', 'Drinking', 'Drinking normally'), ('subjective', 'Energy', 'Normal'),
  ('subjective', 'Vomiting', 'None'), ('subjective', 'Stools', 'Normal'), ('subjective', 'Urine', 'Normal'),
  ('objective', 'Behaviour', 'Bright and alert'), ('objective', 'Hydration', 'Well hydrated'), ('objective', 'Gums', 'Pink'),
  ('objective', 'Heart', 'Normal'), ('objective', 'Lungs', 'Normal'), ('objective', 'Abdomen', 'Soft')
) AS d(f, g, l)
WHERE p."field" = d.f AND p."groupName" = d.g AND p."label" = d.l;
