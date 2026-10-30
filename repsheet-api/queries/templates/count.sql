SELECT count(*)
FROM templates
WHERE user_id = $1;
