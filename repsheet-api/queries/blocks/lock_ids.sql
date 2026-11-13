SELECT id
FROM blocks
WHERE workout_id = $1
ORDER BY position ASC, id ASC
FOR UPDATE;
