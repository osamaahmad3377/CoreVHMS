-- CreateTable
CREATE TABLE "PatientDiaryLink" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "lastViewedAt" TIMESTAMPTZ(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PatientDiaryLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiarySettings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "config" JSONB NOT NULL,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DiarySettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientDiaryLink_token_key" ON "PatientDiaryLink"("token");

-- CreateIndex
CREATE INDEX "PatientDiaryLink_patientId_revokedAt_idx" ON "PatientDiaryLink"("patientId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiarySettings_organizationId_key" ON "DiarySettings"("organizationId");

-- AddForeignKey
ALTER TABLE "PatientDiaryLink" ADD CONSTRAINT "PatientDiaryLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDiaryLink" ADD CONSTRAINT "PatientDiaryLink_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiarySettings" ADD CONSTRAINT "DiarySettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
