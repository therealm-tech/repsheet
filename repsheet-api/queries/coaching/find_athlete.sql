-- $1 coach, $2 athlete.
SELECT
    u.id,
    u.name,
    u.email,
    cl.created_at AS linked_at
FROM coaching_links AS cl
INNER JOIN users AS u ON cl.athlete_id = u.id
WHERE cl.coach_id = $1 AND cl.athlete_id = $2;
