-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "anonymisedAt" TIMESTAMPTZ(3);

-- Owners have full access by definition: grant the new privacy permission to existing owner roles.
INSERT INTO "RolePermission" ("roleId", "permission")
SELECT r.id, 'privacy.manage' FROM "Role" r WHERE r."key" IN ('owner', 'practice_manager') AND r."isSystem"
ON CONFLICT DO NOTHING;
