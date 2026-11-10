INSERT INTO template_block_exercises (
    template_block_id, position, exercise_id, mode, equipment, target
)
SELECT
    $1 AS template_block_id,
    position,
    exercise_id,
    mode,
    equipment,
    target
FROM unnest($2::INTEGER[], $3::UUID[], $4::TEXT[], $5::TEXT[], $6::TEXT[])
    AS s (position, exercise_id, mode, equipment, target);
