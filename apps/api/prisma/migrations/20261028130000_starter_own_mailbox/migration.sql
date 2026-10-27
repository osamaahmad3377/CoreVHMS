-- Starter may send client emails from the clinic's own mailbox (Gmail, Outlook or its mail server).
UPDATE "Plan" SET "features" = array_append("features", 'mailbox')
WHERE NOT ('mailbox' = ANY("features")) AND lower("name") = 'starter';
