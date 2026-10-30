SELECT count(*)
FROM workouts
WHERE user_id = $1;
