DELETE FROM blocks
WHERE id = $1 AND workout_id = $2;
