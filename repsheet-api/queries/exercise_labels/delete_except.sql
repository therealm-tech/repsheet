-- Removes the user's labels on the exercise that $3 no longer lists.
DELETE FROM exercise_labels
WHERE
    user_id = $1
    AND exercise_id = $2
    AND fold(label) <> all(SELECT fold(kept) FROM unnest($3::TEXT[]) AS kept);
