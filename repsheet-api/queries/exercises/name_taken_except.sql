-- Whether another exercise sharing the visibility of the one being renamed
-- (its owner's, or the built-in catalog) already has one of the names.
SELECT EXISTS(
    SELECT 1
    FROM exercises AS other
    WHERE
        other.id <> $1
        AND (other.owner_id IS NULL OR other.owner_id IS NOT DISTINCT FROM $4)
        AND (
            FOLD(other.name_fr) IN (FOLD($2), FOLD($3))
            OR FOLD(other.name_en) IN (FOLD($2), FOLD($3))
        )
);
