SELECT count(*)
FROM exercises AS e
WHERE
    (e.owner_id IS NULL OR e.owner_id = $1)
    AND (NOT $4 OR e.owner_id = $1)
    AND (
        $2::TEXT IS NULL
        OR fold(e.name_fr) LIKE '%' || fold($2) || '%'
        OR fold(e.name_en) LIKE '%' || fold($2) || '%'
    )
    AND (
        $3::TEXT IS NULL
        OR EXISTS (
            SELECT 1
            FROM exercise_labels AS el
            WHERE el.exercise_id = e.id AND el.user_id = $1 AND fold(el.label) = fold($3)
        )
    );
