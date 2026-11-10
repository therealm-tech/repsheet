WITH c AS (
    UPDATE block_exercise_comments
    SET text = $2, updated_at = now()
    WHERE id = $1
    RETURNING id, block_exercise_id, author_id, text, created_at, updated_at
)

SELECT
    c.id,
    c.block_exercise_id,
    c.author_id,
    u.name AS author_name,
    c.text,
    c.created_at,
    c.updated_at
FROM c
LEFT JOIN users AS u ON c.author_id = u.id;
