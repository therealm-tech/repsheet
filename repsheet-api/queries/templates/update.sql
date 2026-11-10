WITH t AS (
    UPDATE templates
    SET name = $3, note = $4, updated_at = now()
    WHERE id = $1 AND user_id = $2
    RETURNING id, name, note, updated_at, author_id
)

SELECT
    t.id,
    t.name,
    t.note,
    t.updated_at,
    t.author_id,
    a.name AS author_name
FROM t
LEFT JOIN users AS a ON t.author_id = a.id;
