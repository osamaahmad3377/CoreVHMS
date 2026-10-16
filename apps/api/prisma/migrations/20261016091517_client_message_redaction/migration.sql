-- Client messages stay a locked correspondence record, with one exception: erasure on request
-- (client anonymisation) may replace the subject, body and the client's name with a fixed marker.
-- Any other change to the content is still refused, and messages still cannot be deleted.
CREATE OR REPLACE FUNCTION client_message_lock() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Client messages cannot be deleted';
  END IF;
  IF NEW.body = '[removed on anonymisation]' AND NEW.subject IS NULL
     AND (NEW."authorName" = OLD."authorName" OR (OLD.direction = 'INBOUND' AND NEW."authorName" = 'Anonymised client'))
     AND (to_jsonb(NEW) - 'readAt' - 'body' - 'subject' - 'authorName') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'readAt' - 'body' - 'subject' - 'authorName') THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'readAt' - 'clientId' - 'patientId') IS DISTINCT FROM (to_jsonb(OLD) - 'readAt' - 'clientId' - 'patientId') THEN
    RAISE EXCEPTION 'Client messages cannot be edited';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
