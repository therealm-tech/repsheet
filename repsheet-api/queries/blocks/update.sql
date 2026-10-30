UPDATE blocks
SET template_block_id = $3, rest_seconds = $4
WHERE id = $1 AND workout_id = $2
RETURNING id, template_block_id, position, rest_seconds;
