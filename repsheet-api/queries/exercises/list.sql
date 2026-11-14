-- $1 user, $2 search text (LIKE-escaped) or NULL, $3 sort by last use, $4 limit, $5 offset,
-- $6 locale of the returned name, $7 label or NULL, $8 only the user's own exercises.
SELECT
    e.id,
    e.owner_id,
    e.name_fr,
    e.name_en,
    e.modes,
    e.default_mode,
    e.load,
    e.equipment,
    e.default_equipment,
    e.grips,
    e.default_grip,
    e.unilateral,
    usage.last_used_on,
    exercise_labels_of(e.id, $1) AS labels,
    exercise_name(e.name_fr, e.name_en, $6) AS name
FROM exercises AS e
LEFT JOIN LATERAL (
    SELECT max(w.performed_on) AS last_used_on
    FROM block_exercises AS be
    INNER JOIN blocks AS b ON be.block_id = b.id
    INNER JOIN workouts AS w ON b.workout_id = w.id
    WHERE be.exercise_id = e.id AND w.user_id = $1
) AS usage ON TRUE
WHERE
    (e.owner_id IS NULL OR e.owner_id = $1)
    AND (NOT $8 OR e.owner_id = $1)
    AND (
        $2::TEXT IS NULL
        OR fold(e.name_fr) LIKE '%' || fold($2) || '%'
        OR fold(e.name_en) LIKE '%' || fold($2) || '%'
    )
    AND (
        $7::TEXT IS NULL
        OR EXISTS (
            SELECT 1
            FROM exercise_labels AS el
            WHERE el.exercise_id = e.id AND el.user_id = $1 AND fold(el.label) = fold($7)
        )
    )
ORDER BY
    CASE WHEN $3 THEN usage.last_used_on END DESC NULLS LAST,
    fold(exercise_name(e.name_fr, e.name_en, $6)) ASC
LIMIT $4 OFFSET $5;
