-- Comment $1, with the workout it is on and that workout's owner.
SELECT
    c.id,
    c.block_exercise_id,
    c.author_id,
    u.name AS author_name,
    c.text,
    c.created_at,
    c.updated_at,
    w.id AS workout_id,
    w.user_id AS owner_id
FROM block_exercise_comments AS c
INNER JOIN block_exercises AS be ON c.block_exercise_id = be.id
INNER JOIN blocks AS b ON be.block_id = b.id
INNER JOIN workouts AS w ON b.workout_id = w.id
LEFT JOIN users AS u ON c.author_id = u.id
WHERE c.id = $1;
