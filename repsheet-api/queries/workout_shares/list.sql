SELECT
    coach_id,
    created_at AS shared_at
FROM workout_shares
WHERE workout_id = $1
ORDER BY created_at ASC, coach_id ASC
LIMIT $2 OFFSET $3;
