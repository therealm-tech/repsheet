-- The block exercises of block $1 of workout $2; no row when the block is not
-- one of the workout's, a null when it has no exercise.
SELECT be.id
FROM blocks AS b
LEFT JOIN block_exercises AS be ON b.id = be.block_id
WHERE b.id = $1 AND b.workout_id = $2;
