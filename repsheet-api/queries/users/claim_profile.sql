-- Turns profile $1 into an account with these credentials and preferences.
UPDATE users
SET
    name = $2,
    email = $3,
    password_hash = $4,
    weight_unit = $5,
    locale = $6,
    managed_by = NULL
WHERE id = $1 AND managed_by IS NOT NULL
RETURNING id, name, email, weight_unit, role, locale, created_at;
