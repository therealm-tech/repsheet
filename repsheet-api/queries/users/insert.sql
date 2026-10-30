INSERT INTO users (name, email, password_hash, weight_unit, locale)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, name, email, weight_unit, role, locale, created_at;
