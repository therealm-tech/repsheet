DELETE FROM workouts
WHERE id = $1 AND acts_for(user_id, $2);
