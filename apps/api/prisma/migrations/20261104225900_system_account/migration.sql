-- AlterEnum
ALTER TYPE "AuthTokenType" ADD VALUE 'SYSTEM_SIGN_IN';

-- AlterTable
ALTER TABLE "AuthToken" ADD COLUMN     "supportBy" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "supportBy" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isSystemAccount" BOOLEAN NOT NULL DEFAULT false;

-- Every clinic gets NextCore's built-in System account (support access): no password, owner role, every active
-- branch. One account per database, a membership per organization. Clinics created later get it when set up.
INSERT INTO "User" ("id", "email", "name", "isSystemAccount", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'system@nextcore.internal', 'System (NextCore support)', true, 'ACTIVE', now(), now()
WHERE EXISTS (SELECT 1 FROM "Organization")
ON CONFLICT ("email") DO NOTHING;

INSERT INTO "Membership" ("id", "organizationId", "userId", "status", "jobTitle", "isClinician", "joinedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", u."id", 'ACTIVE', 'NextCore support', false, now(), now(), now()
FROM "Organization" o CROSS JOIN "User" u
WHERE u."email" = 'system@nextcore.internal' AND u."isSystemAccount"
ON CONFLICT ("organizationId", "userId") DO NOTHING;

INSERT INTO "MembershipRole" ("membershipId", "roleId")
SELECT m."id", r."id"
FROM "Membership" m
JOIN "User" u ON u."id" = m."userId" AND u."isSystemAccount"
JOIN "Role" r ON r."organizationId" = m."organizationId" AND r."key" = 'owner'
ON CONFLICT DO NOTHING;

INSERT INTO "MembershipBranch" ("membershipId", "branchId")
SELECT m."id", b."id"
FROM "Membership" m
JOIN "User" u ON u."id" = m."userId" AND u."isSystemAccount"
JOIN "Branch" b ON b."organizationId" = m."organizationId" AND b."isActive"
ON CONFLICT DO NOTHING;
