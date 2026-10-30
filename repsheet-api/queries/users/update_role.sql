UPDATE users
SET role = $2
WHERE id = $1
RETURNING id, name, email, weight_unit, role, locale, created_at;
