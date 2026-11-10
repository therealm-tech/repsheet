-- The workouts of athlete $1 shared with coach $2, $3 limit, $4 offset.
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
INNER JOIN workout_shares AS ws ON w.id = ws.workout_id
WHERE w.user_id = $1 AND ws.coach_id = $2
ORDER BY w.performed_on DESC, w.created_at DESC
LIMIT $3 OFFSET $4;
