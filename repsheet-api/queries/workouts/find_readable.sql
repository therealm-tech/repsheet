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
            AND coach_reads_workout(w.id, w.template_id, $2)
        )
    );
