-- Puts block $2 at position $3 and numbers the other blocks of workout $1
-- around it from 1, in their current order.
WITH others AS (
    SELECT
        id,
        row_number() OVER (ORDER BY position ASC, id ASC) AS rank
    FROM blocks
    WHERE workout_id = $1 AND id <> $2
),

numbered AS (
    SELECT
        id,
        CASE WHEN rank < $3::integer THEN rank ELSE rank + 1 END AS position
    FROM others
    UNION ALL
    SELECT
        $2::uuid AS id,
        $3::integer AS position
)

UPDATE blocks AS b
SET position = numbered.position
FROM numbered
WHERE b.id = numbered.id AND b.workout_id = $1;
