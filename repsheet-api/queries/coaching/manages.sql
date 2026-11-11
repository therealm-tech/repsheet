-- Whether account $2 coaches athlete $1, and if so whether they manage the
-- athlete's profile; no row when they do not coach them.
SELECT coalesce(u.managed_by = $2, FALSE)
FROM coaching_links AS cl
INNER JOIN users AS u ON cl.athlete_id = u.id
WHERE cl.athlete_id = $1 AND cl.coach_id = $2;
