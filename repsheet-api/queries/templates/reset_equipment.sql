-- Template exercises done with equipment the exercise no longer offers ($3 is
-- its equipment) fall back on its default equipment $2.
UPDATE template_block_exercises
SET equipment = $2
WHERE exercise_id = $1 AND NOT equipment = ANY($3);
