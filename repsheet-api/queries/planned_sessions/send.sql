UPDATE templates
SET sent_at = now(), updated_at = now()
WHERE id = $1 AND sent_at IS NULL;
