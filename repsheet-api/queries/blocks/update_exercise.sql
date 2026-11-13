UPDATE block_exercises
SET position = $3, exercise_id = $4, mode = $5, equipment = $6, grip = $7
WHERE id = $1 AND block_id = $2;
