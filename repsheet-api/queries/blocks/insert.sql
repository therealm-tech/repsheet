INSERT INTO blocks (workout_id, template_block_id, position, rest_seconds)
VALUES (
    $1,
    $2,
    (
        SELECT coalesce(max(position), 0) + 1 FROM blocks
        WHERE workout_id = $1
    ),
    $3
)
RETURNING id, template_block_id, position, rest_seconds;
