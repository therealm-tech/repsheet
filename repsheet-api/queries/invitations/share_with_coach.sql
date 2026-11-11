-- Shares every workout of profile $1 with its coach $2, who logged them and
-- keeps reading them once the profile is an account.
INSERT INTO workout_shares (workout_id, coach_id)
SELECT
    w.id,
    $2 AS coach_id
FROM workouts AS w
WHERE w.user_id = $1
ON CONFLICT DO NOTHING;
