-- Locks profile $1 when coach $2 manages it and account $3 has them as a
-- coach; no row otherwise.
SELECT p.id
FROM users AS p
WHERE
    p.id = $1
    AND p.managed_by = $2
    AND EXISTS (
        SELECT 1
        FROM coaching_links AS cl
        INNER JOIN users AS a ON cl.athlete_id = a.id
        WHERE
            cl.athlete_id = $3
            AND cl.coach_id = $2
            AND a.managed_by IS NULL
    )
FOR UPDATE OF p;
