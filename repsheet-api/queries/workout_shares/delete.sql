DELETE FROM workout_shares
WHERE workout_id = $1 AND coach_id = $2;
