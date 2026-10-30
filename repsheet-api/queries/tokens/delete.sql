DELETE FROM access_tokens
WHERE token_hash = $1;
