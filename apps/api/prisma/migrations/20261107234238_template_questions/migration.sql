-- AlterTable
ALTER TABLE "ClinicalTemplate" ADD COLUMN     "advice" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "diagnoses" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "icon" TEXT NOT NULL DEFAULT 'file';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "templateQuestionsSeeded" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TemplateQuestion" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "ask" TEXT NOT NULL,
    "multi" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TemplateQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateAnswer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TemplateAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemplateQuestion_organizationId_templateId_sortOrder_idx" ON "TemplateQuestion"("organizationId", "templateId", "sortOrder");

-- CreateIndex
CREATE INDEX "TemplateAnswer_organizationId_questionId_sortOrder_idx" ON "TemplateAnswer"("organizationId", "questionId", "sortOrder");

-- AddForeignKey
ALTER TABLE "TemplateQuestion" ADD CONSTRAINT "TemplateQuestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateQuestion" ADD CONSTRAINT "TemplateQuestion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ClinicalTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateAnswer" ADD CONSTRAINT "TemplateAnswer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateAnswer" ADD CONSTRAINT "TemplateAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "TemplateQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
