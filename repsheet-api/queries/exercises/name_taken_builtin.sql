SELECT EXISTS(
    SELECT 1
    FROM exercises
    WHERE
        owner_id IS NULL
        AND (FOLD(name_fr) IN (FOLD($1), FOLD($2)) OR FOLD(name_en) IN (FOLD($1), FOLD($2)))
);
