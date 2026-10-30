UPDATE templates
SET name = $3, note = $4, updated_at = now()
WHERE id = $1 AND user_id = $2
RETURNING id, name, note, updated_at;
