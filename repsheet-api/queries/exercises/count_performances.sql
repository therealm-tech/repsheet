SELECT count(*)
FROM block_exercises AS be
INNER JOIN blocks AS b ON be.block_id = b.id
INNER JOIN workouts AS w ON b.workout_id = w.id
WHERE
    be.exercise_id = $1
    AND w.user_id = $2
    AND ($4::TEXT IS NULL OR be.mode = $4)
    AND (
        $3::UUID IS NULL
        OR (w.performed_on, w.created_at) < (
            SELECT
                ref.performed_on,
                ref.created_at
            FROM workouts AS ref
            WHERE ref.id = $3
        )
    );
