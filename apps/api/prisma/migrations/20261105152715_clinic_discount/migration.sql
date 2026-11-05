-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "discountEndsAt" TIMESTAMPTZ(3),
ADD COLUMN     "discountNote" TEXT,
ADD COLUMN     "discountType" "DiscountType",
ADD COLUMN     "discountValue" INTEGER;

-- A discount has both a type and a value (or neither); a percentage is 1–100, an amount more than 0.
-- (Every part is spelled out: in SQL a comparison with NULL is "unknown", which a CHECK lets through.)
ALTER TABLE "Tenant" ADD CONSTRAINT "tenant_discount_valid" CHECK (
  ("discountType" IS NULL AND "discountValue" IS NULL)
  OR (
    "discountType" IS NOT NULL AND "discountValue" IS NOT NULL
    AND (("discountType" = 'PERCENT' AND "discountValue" BETWEEN 1 AND 100) OR ("discountType" = 'AMOUNT' AND "discountValue" > 0))
  )
);
