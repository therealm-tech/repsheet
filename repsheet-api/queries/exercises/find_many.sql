SELECT
    id,
    modes,
    default_mode,
    load,
    equipment,
    default_equipment,
    unilateral,
    exercise_name(name_fr, name_en, $3) AS name
FROM exercises
WHERE id = any($1) AND (owner_id IS NULL OR owner_id = $2);
