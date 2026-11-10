-- The exercises of block $1 of workout $2, as (block exercise, exercise)
-- pairs; no row when the block is not one of the workout's, a row of nulls
-- when it has no exercise.
SELECT
    be.id,
    be.exercise_id
FROM blocks AS b
LEFT JOIN block_exercises AS be ON b.id = be.block_id
WHERE b.id = $1 AND b.workout_id = $2;
