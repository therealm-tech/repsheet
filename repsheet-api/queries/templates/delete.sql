DELETE FROM templates
WHERE id = $1 AND user_id = $2;
