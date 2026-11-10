-- The comments of the block exercises $1, oldest first.
SELECT
    c.id,
    c.block_exercise_id,
    c.author_id,
    u.name AS author_name,
    c.text,
    c.created_at,
    c.updated_at
FROM block_exercise_comments AS c
LEFT JOIN users AS u ON c.author_id = u.id
WHERE c.block_exercise_id = any($1)
ORDER BY c.block_exercise_id ASC, c.created_at ASC, c.id ASC;
