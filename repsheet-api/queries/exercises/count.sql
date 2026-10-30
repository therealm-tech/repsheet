SELECT count(*)
FROM exercises AS e
WHERE
    (e.owner_id IS NULL OR e.owner_id = $1)
    AND (
        $2::TEXT IS NULL
        OR fold(e.name_fr) LIKE '%' || fold($2) || '%'
        OR fold(e.name_en) LIKE '%' || fold($2) || '%'
    );
