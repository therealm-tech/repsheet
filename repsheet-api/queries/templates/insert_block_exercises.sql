INSERT INTO template_block_exercises (
    template_block_id, position, exercise_id, mode, equipment, grip, target
)
SELECT
    $1 AS template_block_id,
    position,
    exercise_id,
    mode,
    equipment,
    grip,
    target
FROM unnest($2::INTEGER[], $3::UUID[], $4::TEXT[], $5::TEXT[], $6::TEXT[], $7::TEXT[])
    AS s (position, exercise_id, mode, equipment, grip, target);
