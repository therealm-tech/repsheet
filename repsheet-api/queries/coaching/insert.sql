WITH link AS (
    INSERT INTO coaching_links (athlete_id, coach_id)
    VALUES ($1, $2)
    RETURNING coach_id, created_at
)

SELECT
    u.id,
    u.name,
    u.email,
    link.created_at AS linked_at
FROM link
INNER JOIN users AS u ON link.coach_id = u.id;
