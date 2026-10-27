-- WhatsApp Business became a plan feature. Plans keep WhatsApp as before, except Starter (sends client messages by email).
UPDATE "Plan" SET "features" = array_append("features", 'whatsapp')
WHERE NOT ('whatsapp' = ANY("features")) AND lower("name") <> 'starter';
