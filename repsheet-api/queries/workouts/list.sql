SELECT
    w.id,
    w.name,
    w.template_id,
    w.performed_on,
    w.duration_minutes,
    (
        SELECT count(*) FROM blocks AS b
        WHERE b.workout_id = w.id
    ) AS block_count
FROM workouts AS w
WHERE w.user_id = $1
ORDER BY w.performed_on DESC, w.created_at DESC
LIMIT $2 OFFSET $3;
