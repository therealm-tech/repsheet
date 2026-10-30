SELECT
    id,
    password_hash
FROM users
WHERE lower(email) = lower($1);
