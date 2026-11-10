SELECT count(*)
FROM block_exercises AS be
INNER JOIN blocks AS b ON be.block_id = b.id
INNER JOIN workouts AS w ON b.workout_id = w.id
WHERE
    be.exercise_id = $1
    AND w.user_id = $2
    AND ($4::TEXT IS NULL OR be.mode = $4)
    AND ($5::TEXT IS NULL OR be.equipment = $5)
    AND (NOT $6 OR be.grip IS NOT DISTINCT FROM $7::TEXT)
    AND ($8::UUID IS NULL OR coach_reads_workout(w.id, w.template_id, $8))
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
