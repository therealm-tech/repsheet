SELECT
    workout_id,
    id,
    template_block_id,
    position,
    rest_seconds
FROM blocks
WHERE workout_id = any($1)
ORDER BY workout_id ASC, position ASC;
