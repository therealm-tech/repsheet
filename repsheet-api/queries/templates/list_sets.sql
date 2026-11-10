SELECT
    template_block_exercise_id,
    round,
    reps,
    weight_kg,
    duration_seconds,
    distance_meters,
    warmup
FROM template_block_sets
WHERE template_block_exercise_id = any($1)
ORDER BY template_block_exercise_id ASC, round ASC;
