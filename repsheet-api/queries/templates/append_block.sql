INSERT INTO template_blocks (template_id, position, rounds)
VALUES (
    $1,
    (
        SELECT coalesce(max(position), 0) + 1 FROM template_blocks
        WHERE template_id = $1
    ),
    $2
)
RETURNING id;
