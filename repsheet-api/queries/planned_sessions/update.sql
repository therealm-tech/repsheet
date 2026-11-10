UPDATE templates
SET planned_on = $2, name = $3, note = $4, updated_at = now()
WHERE id = $1;
