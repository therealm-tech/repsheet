-- Adds the labels of $3 the exercise lacks, spelled like the same label on
-- the user's other exercises when there is one, else as first given in $3.
WITH spelled AS (
    SELECT DISTINCT ON (fold(requested.label)) coalesce(existing.label, requested.label) AS label
    FROM unnest($3::TEXT[]) WITH ORDINALITY AS requested (label, position)
    LEFT JOIN exercise_labels AS existing
        ON existing.user_id = $1 AND fold(existing.label) = fold(requested.label)
    ORDER BY fold(requested.label), requested.position
)

INSERT INTO exercise_labels (user_id, exercise_id, label)
SELECT
    $1 AS user_id,
    $2 AS exercise_id,
    spelled.label
FROM spelled
ON CONFLICT (user_id, exercise_id, fold(label)) DO NOTHING;
