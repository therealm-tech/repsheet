SELECT count(*)
FROM users
WHERE
    $1::TEXT IS NULL
    OR fold(name) LIKE '%' || fold($1) || '%'
    OR lower(email) LIKE '%' || lower($1) || '%';
