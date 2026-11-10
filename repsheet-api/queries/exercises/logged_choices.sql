-- What any user logged the exercise with: the modes, the equipment and the
-- grips of its block exercises.
SELECT
    coalesce(array_agg(DISTINCT mode), '{}') AS modes,
    coalesce(array_agg(DISTINCT equipment), '{}') AS equipment,
    coalesce(array_agg(DISTINCT grip) FILTER (WHERE grip IS NOT NULL), '{}') AS grips
FROM block_exercises
WHERE exercise_id = $1;
