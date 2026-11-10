WITH t AS (
    INSERT INTO templates (user_id, name, note, planned_on, author_id)
    VALUES ($1, $2, $3, $4, $5)
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
