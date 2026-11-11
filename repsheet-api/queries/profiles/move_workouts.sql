UPDATE workouts
SET user_id = $2
WHERE user_id = $1;
