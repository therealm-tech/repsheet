UPDATE block_exercises
SET position = $3, mode = $4, equipment = $5, grip = $6
WHERE id = $1 AND block_id = $2;
