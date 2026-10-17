-- Client display names are now first name first ("Bilal Hussain") instead of "Hussain, Bilal",
-- and a single name on its own is allowed. Recompute the stored displayName of individual clients
-- from their stored name parts. Idempotent: rows already in the new form are left untouched.
UPDATE "Client"
SET "displayName" = concat_ws(' ', NULLIF(btrim("firstName"), ''), NULLIF(btrim("lastName"), ''))
WHERE "type" = 'INDIVIDUAL'
  AND (NULLIF(btrim("firstName"), '') IS NOT NULL OR NULLIF(btrim("lastName"), '') IS NOT NULL)
  AND "displayName" IS DISTINCT FROM concat_ws(' ', NULLIF(btrim("firstName"), ''), NULLIF(btrim("lastName"), ''));
