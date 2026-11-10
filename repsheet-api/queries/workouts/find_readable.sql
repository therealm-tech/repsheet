-- Workout $1 as account $2 may read it: its owner, or a coach the owner still
-- has who planned the session it was logged from or was shared it.
SELECT
    w.id,
    w.template_id,
    w.name,
    w.note,
    w.performed_on,
    w.duration_minutes
FROM workouts AS w
WHERE
    w.id = $1
    AND (
        w.user_id = $2
        OR (
            EXISTS (
                SELECT 1 FROM coaching_links AS cl
                WHERE cl.athlete_id = w.user_id AND cl.coach_id = $2
            )
            AND (
                EXISTS (
                    SELECT 1 FROM workout_shares AS ws
                    WHERE ws.workout_id = w.id AND ws.coach_id = $2
                )
                OR EXISTS (
                    SELECT 1 FROM templates AS t
                    WHERE
                        t.id = w.template_id
                        AND t.planned_on IS NOT NULL
                        AND t.author_id = $2
                )
            )
        )
    );
