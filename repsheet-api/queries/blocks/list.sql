SELECT
    id,
    template_block_id,
    position,
    rest_seconds
FROM blocks
WHERE workout_id = $1
ORDER BY position ASC;
