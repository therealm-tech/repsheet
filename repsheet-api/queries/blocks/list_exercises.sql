SELECT
    be.id AS block_exercise_id,
    be.block_id,
    be.mode,
    e.id,
    e.modes,
    e.default_mode,
    e.load,
    e.equipment,
    e.unilateral,
    exercise_name(e.name_fr, e.name_en, $2) AS name
FROM block_exercises AS be
INNER JOIN exercises AS e ON be.exercise_id = e.id
WHERE be.block_id = any($1)
ORDER BY be.block_id ASC, be.position ASC;
