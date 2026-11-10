WITH c AS (
    INSERT INTO block_exercise_comments (block_exercise_id, author_id, text)
    VALUES ($1, $2, $3)
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
