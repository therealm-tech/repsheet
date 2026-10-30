SELECT
    id,
    template_id,
    name,
    note,
    performed_on,
    duration_minutes
FROM workouts
WHERE id = $1 AND user_id = $2;
