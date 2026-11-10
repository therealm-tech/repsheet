INSERT INTO exercises (
    owner_id,
    name_fr,
    name_en,
    modes,
    default_mode,
    load,
    equipment,
    default_equipment,
    grips,
    default_grip,
    unilateral
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING
    id,
    owner_id,
    exercise_name(name_fr, name_en, $12) AS name,
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
    NULL::DATE AS last_used_on;
