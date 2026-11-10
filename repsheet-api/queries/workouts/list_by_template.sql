SELECT
    id,
    template_id,
    name,
    note,
    performed_on,
    duration_minutes
FROM workouts
WHERE template_id = $1
ORDER BY performed_on DESC, created_at DESC
LIMIT $2 OFFSET $3;
