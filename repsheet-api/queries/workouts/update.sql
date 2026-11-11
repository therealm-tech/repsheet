UPDATE workouts
SET name = $3, note = $4, performed_on = $5, duration_minutes = $6
WHERE id = $1 AND acts_for(user_id, $2)
RETURNING id, template_id, name, note, performed_on, duration_minutes;
