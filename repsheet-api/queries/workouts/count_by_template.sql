SELECT count(*)
FROM workouts
WHERE template_id = $1;
