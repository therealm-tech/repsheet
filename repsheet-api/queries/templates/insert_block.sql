INSERT INTO template_blocks (template_id, position, rounds, rest_seconds)
VALUES ($1, $2, $3, $4)
RETURNING id;
