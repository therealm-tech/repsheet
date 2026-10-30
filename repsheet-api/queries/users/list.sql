-- $1 search text (LIKE-escaped) or NULL, $2 limit, $3 offset.
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
    $1::TEXT IS NULL
    OR fold(name) LIKE '%' || fold($1) || '%'
    OR lower(email) LIKE '%' || lower($1) || '%'
ORDER BY lower(email) ASC
LIMIT $2 OFFSET $3;
