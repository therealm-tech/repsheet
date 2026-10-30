INSERT INTO workouts (user_id, template_id, name, performed_on, duration_minutes)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, template_id, name, note, performed_on, duration_minutes;
