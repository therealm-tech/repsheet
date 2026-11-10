-- A draft planned session is its author's to delete, not its athlete's.
DELETE FROM templates
WHERE
    id = $1
    AND user_id = $2
    AND (planned_on IS NULL OR sent_at IS NOT NULL);
