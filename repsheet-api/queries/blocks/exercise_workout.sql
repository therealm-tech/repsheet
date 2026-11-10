SELECT b.workout_id
FROM block_exercises AS be
INNER JOIN blocks AS b ON be.block_id = b.id
WHERE be.id = $1;
