-- Whether any user logged the exercise in one of the modes $2.
SELECT EXISTS(
    SELECT 1
    FROM block_exercises
    WHERE exercise_id = $1 AND mode = ANY($2)
);
