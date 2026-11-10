INSERT INTO exercises (
    owner_id, name_fr, name_en, modes, default_mode, load, equipment, default_equipment, unilateral
)
VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8)
RETURNING
    id,
    owner_id,
    exercise_name(name_fr, name_en, $9) AS name,
    name_fr,
    name_en,
    modes,
    default_mode,
    load,
    equipment,
    default_equipment,
    unilateral,
    NULL::DATE AS last_used_on;
