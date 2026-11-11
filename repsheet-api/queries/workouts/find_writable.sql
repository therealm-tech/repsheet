-- Workout $1 as account $2 may write it: their own, or one of a profile they
-- manage. Returns its owner.
SELECT
    id,
    user_id,
    template_id,
    name,
    note,
    performed_on,
    duration_minutes
FROM workouts
WHERE id = $1 AND acts_for(user_id, $2);
