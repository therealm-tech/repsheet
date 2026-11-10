-- $1 athlete, $2 coach.
SELECT
    u.id,
    u.name,
    u.email,
    cl.created_at AS linked_at
FROM coaching_links AS cl
INNER JOIN users AS u ON cl.coach_id = u.id
WHERE cl.athlete_id = $1 AND cl.coach_id = $2;
