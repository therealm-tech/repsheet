INSERT INTO workout_shares (workout_id, coach_id)
VALUES ($1, $2)
ON CONFLICT (workout_id, coach_id) DO NOTHING;
