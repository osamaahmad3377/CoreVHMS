-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('SELF', 'MANAGER');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "attendanceGraceMinutes" INTEGER NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "StaffAttendance" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "clockInAt" TIMESTAMPTZ(3) NOT NULL,
    "clockOutAt" TIMESTAMPTZ(3),
    "breakStartedAt" TIMESTAMPTZ(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "source" "AttendanceSource" NOT NULL DEFAULT 'SELF',
    "editedById" UUID,
    "editReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StaffAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffAttendance_organizationId_branchId_clockInAt_idx" ON "StaffAttendance"("organizationId", "branchId", "clockInAt");

-- CreateIndex
CREATE INDEX "StaffAttendance_membershipId_clockInAt_idx" ON "StaffAttendance"("membershipId", "clockInAt");

-- AddForeignKey
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rules the database keeps even if the app has a bug.
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_attendance_grace_range" CHECK ("attendanceGraceMinutes" BETWEEN 0 AND 120);
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_out_after_in" CHECK ("clockOutAt" IS NULL OR "clockOutAt" > "clockInAt");
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_break_minutes" CHECK ("breakMinutes" >= 0);
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_break_only_on_shift" CHECK ("breakStartedAt" IS NULL OR ("clockOutAt" IS NULL AND "breakStartedAt" >= "clockInAt"));
-- A person is clocked in at most once at a time (no two open shifts) …
CREATE UNIQUE INDEX "StaffAttendance_one_open_shift" ON "StaffAttendance" ("membershipId") WHERE "clockOutAt" IS NULL;
-- … and shifts never overlap, including ones a manager adds afterwards.
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_no_overlap"
  EXCLUDE USING gist ("membershipId" WITH =, tstzrange("clockInAt", COALESCE("clockOutAt", 'infinity'::timestamptz), '[)') WITH &&);

-- Clocking in and out: every system role that works in the clinic (same as new clinics get).
INSERT INTO "RolePermission" ("roleId", "permission")
SELECT r.id, 'attendance.clock' FROM "Role" r
WHERE r."isSystem" AND r."key" IS NOT NULL AND r."key" <> 'referral_partner'
ON CONFLICT DO NOTHING;

-- Seeing and correcting everyone's attendance: owner and practice manager.
INSERT INTO "RolePermission" ("roleId", "permission")
SELECT r.id, 'attendance.manage' FROM "Role" r
WHERE r."isSystem" AND r."key" IN ('owner', 'practice_manager')
ON CONFLICT DO NOTHING;
