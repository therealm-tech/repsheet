-- One row per time the exercise appears in one of the user's blocks, newest
-- first. $5, when set, keeps only the workouts that come before that workout;
-- $6, when set, only the blocks that counted the exercise in that mode; $7,
-- when set, only those that did it with that equipment; when $8, only those
-- that held the grip $9, or recorded none when $9 is NULL.
SELECT
    be.id AS block_exercise_id,
    w.id AS workout_id,
    w.name AS workout_name,
    w.performed_on,
    be.mode,
    be.equipment,
    be.grip,
    (
        SELECT count(*) FROM block_exercises AS sibling
        WHERE sibling.block_id = b.id)
        AS block_exercise_count
FROM block_exercises AS be
INNER JOIN blocks AS b ON be.block_id = b.id
INNER JOIN workouts AS w ON b.workout_id = w.id
WHERE
    be.exercise_id = $1
    AND w.user_id = $2
    AND ($6::TEXT IS NULL OR be.mode = $6)
    AND ($7::TEXT IS NULL OR be.equipment = $7)
    AND (NOT $8 OR be.grip IS NOT DISTINCT FROM $9::TEXT)
    AND (
        $5::UUID IS NULL
        OR (w.performed_on, w.created_at) < (
            SELECT
                ref.performed_on,
                ref.created_at
            FROM workouts AS ref
            WHERE ref.id = $5
        )
    )
ORDER BY w.performed_on DESC, w.created_at DESC, b.position DESC
LIMIT $3 OFFSET $4;
