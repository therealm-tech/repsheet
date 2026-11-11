SELECT count(*)
FROM users
WHERE
    managed_by IS NULL
    AND (
        $1::TEXT IS NULL
        OR fold(name) LIKE '%' || fold($1) || '%'
        OR lower(email) LIKE '%' || lower($1) || '%'
    );
