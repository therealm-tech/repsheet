SELECT
    tbe.template_block_id,
    tbe.mode,
    tbe.target,
    e.id,
    e.modes,
    e.default_mode,
    e.load,
    e.equipment,
    e.unilateral,
    exercise_name(e.name_fr, e.name_en, $2) AS name
FROM template_block_exercises AS tbe
INNER JOIN exercises AS e ON tbe.exercise_id = e.id
WHERE tbe.template_block_id = any($1)
ORDER BY tbe.template_block_id ASC, tbe.position ASC;
