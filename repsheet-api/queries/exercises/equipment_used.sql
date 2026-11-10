-- Whether any user logged the exercise with one of the equipment $2.
SELECT EXISTS(
    SELECT 1
    FROM block_exercises
    WHERE exercise_id = $1 AND equipment = ANY($2)
);
