-- Template exercises counted in a mode, done with equipment or held with a
-- grip the exercise no longer offers ($2, $4 and $6) fall back on its default
-- ones ($3, $5 and $7, which is NULL when it offers no grip).
UPDATE template_block_exercises
SET
    mode = CASE WHEN mode = any($2) THEN mode ELSE $3 END,
    equipment = CASE WHEN equipment = any($4) THEN equipment ELSE $5 END,
    grip = CASE WHEN grip IS NULL OR grip = any($6) THEN grip ELSE $7::TEXT END
WHERE
    exercise_id = $1
    AND (NOT mode = any($2) OR NOT equipment = any($4) OR NOT grip = any($6));
