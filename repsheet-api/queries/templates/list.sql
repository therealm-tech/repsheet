-- The template library: planned sessions are dated templates and stay out.
SELECT
    t.id,
    t.name,
    t.updated_at,
    (
        SELECT count(*) FROM template_blocks AS tb
        WHERE tb.template_id = t.id
    ) AS block_count
FROM templates AS t
WHERE t.user_id = $1 AND t.planned_on IS NULL
ORDER BY t.name ASC
LIMIT $2 OFFSET $3;
