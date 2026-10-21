-- Repeating care items with their own interval and end (vaccination "every week / month / N days…").
CREATE TYPE "CareRepeatUnit" AS ENUM ('DAY', 'WEEK', 'MONTH', 'YEAR');
ALTER TABLE "CareItem"
  ADD COLUMN "repeatEvery" INTEGER,
  ADD COLUMN "repeatUnit" "CareRepeatUnit",
  ADD COLUMN "repeatTimes" INTEGER,
  ADD COLUMN "repeatUntil" DATE;
ALTER TABLE "CareItem" ADD CONSTRAINT "CareItem_repeat_valid" CHECK (
  ("repeatEvery" IS NULL OR "repeatEvery" BETWEEN 0 AND 999)
  AND ("repeatEvery" IS NULL OR "repeatEvery" = 0 OR "repeatUnit" IS NOT NULL)
  AND ("repeatTimes" IS NULL OR "repeatTimes" BETWEEN 0 AND 100)
);
