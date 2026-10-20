-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "notePhrasesSeeded" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "NotePhrase" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "groupName" TEXT,
    "label" TEXT NOT NULL,
    "text" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotePhrase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotePhrase_organizationId_field_sortOrder_idx" ON "NotePhrase"("organizationId", "field", "sortOrder");

-- AddForeignKey
ALTER TABLE "NotePhrase" ADD CONSTRAINT "NotePhrase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
