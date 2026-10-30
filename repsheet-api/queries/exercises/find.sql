SELECT
    e.id,
    e.owner_id,
    e.name_fr,
    e.name_en,
    e.modes,
    e.default_mode,
    e.load,
    e.equipment,
    e.unilateral,
    exercise_name(e.name_fr, e.name_en, $3) AS name,
    (
        SELECT max(w.performed_on)
        FROM block_exercises AS be
        INNER JOIN blocks AS b ON be.block_id = b.id
        INNER JOIN workouts AS w ON b.workout_id = w.id
        WHERE be.exercise_id = e.id AND w.user_id = $2
    ) AS last_used_on
FROM exercises AS e
WHERE e.id = $1 AND (e.owner_id IS NULL OR e.owner_id = $2);
