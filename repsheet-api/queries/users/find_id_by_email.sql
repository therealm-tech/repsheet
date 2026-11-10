SELECT id
FROM users
WHERE lower(email) = lower($1);
