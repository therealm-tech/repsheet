-- $1 coach, $2 limit, $3 offset.
SELECT
    u.id,
    u.name,
    u.email,
    u.weight_unit,
    cl.created_at AS linked_at,
    u.managed_by IS NOT NULL AS managed
FROM coaching_links AS cl
INNER JOIN users AS u ON cl.athlete_id = u.id
WHERE cl.coach_id = $1
ORDER BY fold(u.name) ASC, u.id ASC
LIMIT $2 OFFSET $3;
