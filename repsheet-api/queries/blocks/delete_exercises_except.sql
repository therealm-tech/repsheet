DELETE FROM block_exercises
WHERE block_id = $1 AND NOT (id = any($2));
