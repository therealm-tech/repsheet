SELECT
    tbe.id AS template_block_exercise_id,
    tbe.template_block_id,
    tbe.mode,
    tbe.equipment AS chosen_equipment,
    tbe.grip AS chosen_grip,
    tbe.target,
    e.id,
    e.modes,
    e.default_mode,
    e.load,
    e.equipment,
    e.default_equipment,
    e.grips,
    e.default_grip,
    e.unilateral,
    exercise_name(e.name_fr, e.name_en, $2) AS name
FROM template_block_exercises AS tbe
INNER JOIN exercises AS e ON tbe.exercise_id = e.id
WHERE tbe.template_block_id = any($1)
ORDER BY tbe.template_block_id ASC, tbe.position ASC;
