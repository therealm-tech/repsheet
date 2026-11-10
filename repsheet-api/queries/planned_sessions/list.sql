-- $1 athlete, $2 author or NULL for every author, $3 limit, $4 offset.
SELECT
    t.id,
    t.user_id AS athlete_id,
    t.author_id,
    a.name AS author_name,
    t.planned_on,
    t.name,
    t.updated_at,
    (
        SELECT count(*) FROM template_blocks AS tb
        WHERE tb.template_id = t.id
    ) AS block_count,
    (
        SELECT count(*) FROM workouts AS w
        WHERE w.template_id = t.id
    ) AS workout_count
FROM templates AS t
LEFT JOIN users AS a ON t.author_id = a.id
WHERE
    t.user_id = $1
    AND t.planned_on IS NOT NULL
    AND ($2::UUID IS NULL OR t.author_id = $2)
ORDER BY t.planned_on DESC, t.created_at DESC
LIMIT $3 OFFSET $4;
