-- Deletes block $1 of template $2 and numbers the blocks left from 1, in their
-- current order, so positions stay contiguous.
WITH deleted AS (
    DELETE FROM template_blocks
    WHERE id = $1 AND template_id = $2
    RETURNING id
),

ranked AS (
    SELECT
        id,
        row_number() OVER (ORDER BY position ASC, id ASC) AS rank
    FROM template_blocks
    WHERE template_id = $2 AND id <> $1
)

UPDATE template_blocks AS b
SET position = ranked.rank
FROM ranked
WHERE b.id = ranked.id AND b.position <> ranked.rank;
