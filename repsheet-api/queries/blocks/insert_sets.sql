INSERT INTO workout_sets (
    block_exercise_id, round, reps, weight_kg, duration_seconds, distance_meters, warmup
)
SELECT
    $1 AS block_exercise_id,
    round,
    reps,
    weight_kg,
    duration_seconds,
    distance_meters,
    warmup
FROM unnest(
    $2::INTEGER[],
    $3::INTEGER[],
    $4::DOUBLE PRECISION[],
    $5::INTEGER[],
    $6::INTEGER[],
    $7::BOOLEAN[]
) AS s (round, reps, weight_kg, duration_seconds, distance_meters, warmup);
