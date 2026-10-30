SELECT
    id,
    name,
    email,
    weight_unit,
    role,
    locale,
    created_at
FROM users
WHERE id = $1;
