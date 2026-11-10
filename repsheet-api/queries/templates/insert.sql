INSERT INTO templates (user_id, name, note, planned_on, author_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, name, note, updated_at;
