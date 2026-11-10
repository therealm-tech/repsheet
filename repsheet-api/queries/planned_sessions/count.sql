SELECT count(*)
FROM templates
WHERE
    user_id = $1
    AND planned_on IS NOT NULL
    AND ($2::UUID IS NULL OR author_id = $2);
