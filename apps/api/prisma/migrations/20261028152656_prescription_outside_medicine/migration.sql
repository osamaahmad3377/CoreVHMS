-- AlterTable
ALTER TABLE "PrescriptionItem" ADD COLUMN     "outsideName" TEXT,
ALTER COLUMN "productId" DROP NOT NULL;

-- Each line is a pharmacy medicine or a medicine bought outside (by name).
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_product_or_outside" CHECK ("productId" IS NOT NULL OR "outsideName" IS NOT NULL);

-- The name of a medicine bought outside is frozen with the rest of an authorised prescription.
CREATE OR REPLACE FUNCTION prescription_item_frozen() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM "Prescription" WHERE id = COALESCE(OLD."prescriptionId", NEW."prescriptionId");
  IF st IS NULL OR st = 'DRAFT' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Items of an authorised prescription cannot be removed'; END IF;
  IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'Items cannot be added to an authorised prescription'; END IF;
  IF NEW."productId" IS DISTINCT FROM OLD."productId" OR NEW."outsideName" IS DISTINCT FROM OLD."outsideName"
     OR NEW."doseValue" IS DISTINCT FROM OLD."doseValue"
     OR NEW."doseUnit" IS DISTINCT FROM OLD."doseUnit" OR NEW."amountPerDose" IS DISTINCT FROM OLD."amountPerDose"
     OR NEW.route IS DISTINCT FROM OLD.route OR NEW."frequencyText" IS DISTINCT FROM OLD."frequencyText"
     OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.instructions IS DISTINCT FROM OLD.instructions
     OR NEW.repeats IS DISTINCT FROM OLD.repeats OR NEW."durationDays" IS DISTINCT FROM OLD."durationDays" THEN
    RAISE EXCEPTION 'Authorised prescriptions are immutable; cancel and re-prescribe instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
