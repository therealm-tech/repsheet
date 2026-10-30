UPDATE template_blocks
SET position = $3, rounds = $4, rest_seconds = $5
WHERE id = $1 AND template_id = $2;
