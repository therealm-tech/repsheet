UPDATE users
SET role = $2
WHERE id = $1 AND managed_by IS NULL
RETURNING id, name, email, weight_unit, role, locale, created_at;
