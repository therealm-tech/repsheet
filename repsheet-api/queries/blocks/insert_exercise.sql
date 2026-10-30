INSERT INTO block_exercises (block_id, position, exercise_id, mode)
VALUES ($1, $2, $3, $4)
RETURNING id;
