-- The planned session $1 as account $2 may see it: its athlete once it is
-- sent, its author while the athlete still has them as a coach.
SELECT
    t.id,
    t.user_id AS athlete_id,
    t.author_id,
    a.name AS author_name,
    t.planned_on,
    t.name,
    t.note,
    t.sent_at,
    t.updated_at
FROM templates AS t
LEFT JOIN users AS a ON t.author_id = a.id
WHERE
    t.id = $1
    AND t.planned_on IS NOT NULL
    AND (
        (t.user_id = $2 AND t.sent_at IS NOT NULL)
        OR (
            t.author_id = $2
            AND EXISTS (
                SELECT 1 FROM coaching_links AS cl
                WHERE cl.athlete_id = t.user_id AND cl.coach_id = $2
            )
        )
    );
