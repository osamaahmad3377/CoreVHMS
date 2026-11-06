-- Permanent delete of clients and animals added by mistake (only while they have no history).
-- Existing clinics' owner and practice-manager roles get it, the same as new clinics.
INSERT INTO "RolePermission" ("roleId", "permission")
SELECT r.id, p.permission FROM "Role" r
CROSS JOIN (VALUES ('clients.delete'), ('patients.delete')) AS p(permission)
WHERE r."isSystem" AND r."key" IN ('owner', 'practice_manager')
ON CONFLICT DO NOTHING;
