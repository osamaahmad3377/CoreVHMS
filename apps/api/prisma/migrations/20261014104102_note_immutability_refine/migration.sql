-- Signed notes: clinical content and signature are frozen. Linking fields (patientId after a merge)
-- may be re-pointed, and the only permitted status change is SIGNED -> SUPERSEDED.
CREATE OR REPLACE FUNCTION clinical_note_signed_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status NOT IN ('SIGNED', 'SUPERSEDED') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Signed clinical notes cannot be deleted';
  END IF;
  IF NOT (NEW.status = OLD.status OR (OLD.status = 'SIGNED' AND NEW.status = 'SUPERSEDED')) THEN
    RAISE EXCEPTION 'Invalid status change for a signed clinical note';
  END IF;
  IF NEW."subjective" IS DISTINCT FROM OLD."subjective"
     OR NEW."objective" IS DISTINCT FROM OLD."objective"
     OR NEW."assessment" IS DISTINCT FROM OLD."assessment"
     OR NEW."plan" IS DISTINCT FROM OLD."plan"
     OR NEW."history" IS DISTINCT FROM OLD."history"
     OR NEW."presentingComplaint" IS DISTINCT FROM OLD."presentingComplaint"
     OR NEW."followUpInstructions" IS DISTINCT FROM OLD."followUpInstructions"
     OR NEW."examFindings"::text IS DISTINCT FROM OLD."examFindings"::text
     OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
     OR NEW."signedById" IS DISTINCT FROM OLD."signedById"
     OR NEW."signedAt" IS DISTINCT FROM OLD."signedAt"
     OR NEW."authorId" IS DISTINCT FROM OLD."authorId"
     OR NEW."encounterId" IS DISTINCT FROM OLD."encounterId"
     OR NEW."version" IS DISTINCT FROM OLD."version" THEN
    RAISE EXCEPTION 'Signed clinical notes are immutable; create an amendment instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
