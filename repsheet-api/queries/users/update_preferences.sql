UPDATE users
SET locale = $2, weight_unit = $3
WHERE id = $1
RETURNING id, name, email, weight_unit, role, locale, created_at;
