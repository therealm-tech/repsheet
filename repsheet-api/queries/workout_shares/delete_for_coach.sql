-- The shares athlete $1 made with coach $2.
DELETE FROM workout_shares AS ws
USING workouts AS w
WHERE ws.workout_id = w.id AND w.user_id = $1 AND ws.coach_id = $2;
