-- The account named by the configuration always exists, with the configured
-- password and the super admin role; its name and unit are only set once.
INSERT INTO users (name, email, password_hash, weight_unit, role)
VALUES ('Super admin', $1, $2, 'kg', 'super_admin')
ON CONFLICT ((lower(email))) DO UPDATE
    SET password_hash = excluded.password_hash, role = 'super_admin'
RETURNING id;
