SELECT count(*)
FROM workouts AS w
INNER JOIN workout_shares AS ws ON w.id = ws.workout_id
WHERE w.user_id = $1 AND ws.coach_id = $2;
