SELECT
    id,
    position,
    rounds,
    rest_seconds
FROM template_blocks
WHERE template_id = $1
ORDER BY position ASC;
