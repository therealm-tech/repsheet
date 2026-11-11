-- $1 search text (LIKE-escaped) or NULL, $2 limit, $3 offset. Profiles that a
-- coach manages are not accounts and stay out.
SELECT
    id,
    name,
    email,
    weight_unit,
    role,
    locale,
    created_at
FROM users
WHERE
    managed_by IS NULL
    AND (
        $1::TEXT IS NULL
        OR fold(name) LIKE '%' || fold($1) || '%'
        OR lower(email) LIKE '%' || lower($1) || '%'
    )
ORDER BY lower(email) ASC
LIMIT $2 OFFSET $3;
