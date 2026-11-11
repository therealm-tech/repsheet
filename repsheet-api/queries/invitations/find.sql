-- The live invitation with token digest $1, with whom it comes from and what
-- the profile already holds.
SELECT
    i.expires_at,
    a.name AS athlete_name,
    c.name AS coach_name,
    (
        SELECT count(*) FROM workouts AS w
        WHERE w.user_id = i.athlete_id
    ) AS workout_count
FROM athlete_invitations AS i
INNER JOIN users AS a ON i.athlete_id = a.id
INNER JOIN users AS c ON a.managed_by = c.id
WHERE i.token_hash = $1 AND i.expires_at > now();
