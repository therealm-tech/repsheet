SELECT
    block_exercise_id,
    round,
    reps,
    weight_kg,
    duration_seconds,
    distance_meters,
    warmup
FROM workout_sets
WHERE block_exercise_id = any($1)
ORDER BY block_exercise_id ASC, round ASC, id ASC;
