-- Template $1 of account $2, with who planned it when it is a planned
-- session: one its athlete sees only once its author sent it.
SELECT
    t.id,
    t.name,
    t.note,
    t.updated_at,
    t.author_id,
    a.name AS author_name
FROM templates AS t
LEFT JOIN users AS a ON t.author_id = a.id
WHERE
    t.id = $1
    AND t.user_id = $2
    AND (t.planned_on IS NULL OR t.sent_at IS NOT NULL);
