-- Whether an exercise visible to the user already has one of the names, in
-- either language.
SELECT EXISTS(
    SELECT 1
    FROM exercises
    WHERE
        (owner_id IS NULL OR owner_id = $1)
        AND (FOLD(name_fr) IN (FOLD($2), FOLD($3)) OR FOLD(name_en) IN (FOLD($2), FOLD($3)))
);
