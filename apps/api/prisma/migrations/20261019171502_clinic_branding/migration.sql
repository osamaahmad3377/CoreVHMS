-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "brandName" TEXT,
ADD COLUMN     "brandingUpdatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "iconAttachmentId" UUID,
ADD COLUMN     "loginHeadline" TEXT,
ADD COLUMN     "loginMessage" TEXT,
ADD COLUMN     "sidebarColor" TEXT;

-- Branding is owner-only: the new permission goes to every clinic's system owner role.
INSERT INTO "RolePermission" ("roleId", "permission")
SELECT r.id, 'branding.manage' FROM "Role" r
WHERE r."isSystem" AND r."key" = 'owner'
ON CONFLICT DO NOTHING;

-- Colours are stored as #rrggbb (also enforced by the API).
UPDATE "Organization" SET "primaryColor" = lower("primaryColor") WHERE "primaryColor" IS NOT NULL;
UPDATE "Organization" SET "primaryColor" = NULL WHERE "primaryColor" !~ '^#[0-9a-f]{6}$';
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_primaryColor_hex" CHECK ("primaryColor" IS NULL OR "primaryColor" ~ '^#[0-9a-f]{6}$');
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_sidebarColor_hex" CHECK ("sidebarColor" IS NULL OR "sidebarColor" ~ '^#[0-9a-f]{6}$');
