-- The user's labels, each with the number of exercises it is on.
SELECT
    min(label) AS name,
    count(*) AS exercise_count
FROM exercise_labels
WHERE user_id = $1
GROUP BY fold(label)
ORDER BY fold(label)
LIMIT $2 OFFSET $3;
