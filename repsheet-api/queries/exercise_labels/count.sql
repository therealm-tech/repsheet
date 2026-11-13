SELECT count(DISTINCT fold(label))
FROM exercise_labels
WHERE user_id = $1;
