-- Lines of an issued invoice stay frozen. The two "returned so far" counters may grow (a counter return), and
-- nothing else on the line may change at the same time; they never go down.
CREATE OR REPLACE FUNCTION invoice_line_frozen() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM "Invoice" WHERE id = COALESCE(NEW."invoiceId", OLD."invoiceId");
  IF st IS NULL OR st = 'DRAFT' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."stockIssued" IS DISTINCT FROM OLD."stockIssued"
     AND NEW."grossMinor" = OLD."grossMinor" AND NEW."netMinor" = OLD."netMinor" AND NEW."taxMinor" = OLD."taxMinor"
     AND NEW.quantity = OLD.quantity AND NEW."unitPriceMinor" = OLD."unitPriceMinor" AND NEW.description = OLD.description THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW."returnedQuantity" IS DISTINCT FROM OLD."returnedQuantity" OR NEW."returnedMinor" IS DISTINCT FROM OLD."returnedMinor")
     AND NEW."returnedQuantity" >= OLD."returnedQuantity" AND NEW."returnedMinor" >= OLD."returnedMinor"
     AND NEW."returnedQuantity" <= NEW.quantity AND NEW."returnedMinor" <= NEW."grossMinor"
     AND NEW."stockIssued" = OLD."stockIssued" AND NEW."invoiceId" = OLD."invoiceId" AND NEW.description = OLD.description
     AND NEW."grossMinor" = OLD."grossMinor" AND NEW."netMinor" = OLD."netMinor" AND NEW."taxMinor" = OLD."taxMinor"
     AND NEW.quantity = OLD.quantity AND NEW."unitPriceMinor" = OLD."unitPriceMinor" AND NEW."discountMinor" = OLD."discountMinor"
     AND NEW."productId" IS NOT DISTINCT FROM OLD."productId" AND NEW."serviceId" IS NOT DISTINCT FROM OLD."serviceId" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Lines of an issued invoice cannot be changed; use a credit note or void the invoice';
END;
$$ LANGUAGE plpgsql;
