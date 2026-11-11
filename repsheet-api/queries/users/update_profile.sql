-- Profile $1 as its manager $2 edits it; no row when $2 does not manage it.
UPDATE users
SET name = $3, weight_unit = $4
WHERE id = $1 AND managed_by = $2
RETURNING id;
