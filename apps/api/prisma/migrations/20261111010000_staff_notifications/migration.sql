-- CreateEnum
CREATE TYPE "StaffNotificationKind" AS ENUM ('ONLINE_BOOKED', 'ONLINE_RESCHEDULED', 'ONLINE_CANCELLED');

-- CreateTable
CREATE TABLE "StaffNotification" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "kind" "StaffNotificationKind" NOT NULL,
    "appointmentId" UUID,
    "previousStartsAt" TIMESTAMPTZ(6),
    "detail" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffNotificationRead" (
    "notificationId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "readAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffNotificationRead_pkey" PRIMARY KEY ("notificationId","userId")
);

-- CreateIndex
CREATE INDEX "StaffNotification_organizationId_branchId_createdAt_idx" ON "StaffNotification"("organizationId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "StaffNotificationRead_userId_idx" ON "StaffNotificationRead"("userId");

-- AddForeignKey
ALTER TABLE "StaffNotification" ADD CONSTRAINT "StaffNotification_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffNotificationRead" ADD CONSTRAINT "StaffNotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "StaffNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

