SELECT
    u.id,
    u.role,
    u.locale
FROM access_tokens AS t
INNER JOIN users AS u ON t.user_id = u.id
WHERE t.token_hash = $1 AND t.expires_at > now();
