-- $1 coach, $2 athlete.
SELECT
    u.id,
    u.name,
    u.email,
    u.weight_unit,
    cl.created_at AS linked_at,
    u.managed_by IS NOT NULL AS managed
FROM coaching_links AS cl
INNER JOIN users AS u ON cl.athlete_id = u.id
WHERE cl.coach_id = $1 AND cl.athlete_id = $2;
