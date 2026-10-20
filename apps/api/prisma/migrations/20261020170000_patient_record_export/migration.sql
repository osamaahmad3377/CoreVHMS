-- Downloading a patient's complete record: the new permission goes to the clinic's system owner, practice
-- manager and veterinarian roles (the same roles that receive it in new clinics).
INSERT INTO "RolePermission" ("roleId", "permission")
SELECT r.id, 'patients.export' FROM "Role" r
WHERE r."isSystem" AND r."key" IN ('owner', 'practice_manager', 'veterinarian')
ON CONFLICT DO NOTHING;
