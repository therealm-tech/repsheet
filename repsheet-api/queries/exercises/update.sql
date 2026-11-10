-- $12 is the user whose last use the returned row reflects, $13 their locale.
UPDATE exercises
SET
    name_fr = $2,
    name_en = $3,
    modes = $4,
    default_mode = $5,
    load = $6,
    equipment = $7,
    default_equipment = $8,
    grips = $9,
    default_grip = $10,
    unilateral = $11
WHERE id = $1
RETURNING
    id,
    owner_id,
    exercise_name(name_fr, name_en, $13) AS name,
    name_fr,
    name_en,
    modes,
    default_mode,
    load,
    equipment,
    default_equipment,
    grips,
    default_grip,
    unilateral,
    (
        SELECT max(w.performed_on)
        FROM block_exercises AS be
        INNER JOIN blocks AS b ON be.block_id = b.id
        INNER JOIN workouts AS w ON b.workout_id = w.id
        WHERE be.exercise_id = exercises.id AND w.user_id = $12
    ) AS last_used_on;
