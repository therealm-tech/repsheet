-- Template exercises counted in a mode the exercise no longer has ($3 are its
-- modes) fall back on its default mode $2.
UPDATE template_block_exercises
SET mode = $2
WHERE exercise_id = $1 AND NOT mode = ANY($3);
