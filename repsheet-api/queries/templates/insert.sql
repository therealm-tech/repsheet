INSERT INTO templates (user_id, name, note)
VALUES ($1, $2, $3)
RETURNING id, name, note, updated_at;
