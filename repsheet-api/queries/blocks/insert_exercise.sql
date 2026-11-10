INSERT INTO block_exercises (block_id, position, exercise_id, mode, equipment)
VALUES ($1, $2, $3, $4, $5)
RETURNING id;
