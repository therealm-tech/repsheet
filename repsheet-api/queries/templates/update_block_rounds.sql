UPDATE template_blocks
SET rounds = $3
WHERE id = $1 AND template_id = $2
RETURNING id;
