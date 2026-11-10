SELECT count(*)
FROM templates
WHERE user_id = $1 AND planned_on IS NULL;
