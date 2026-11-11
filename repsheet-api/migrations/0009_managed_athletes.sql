-- An athlete profile a coach manages for someone with no account: a user row
-- with no credentials, owned by that coach, who reaches it through a coaching
-- link like any other athlete. Deleting the coach deletes the profile.
ALTER TABLE users
ALTER COLUMN email DROP NOT NULL,
ALTER COLUMN password_hash DROP NOT NULL,
ADD COLUMN managed_by UUID REFERENCES users (id) ON DELETE CASCADE,
ADD CONSTRAINT users_credentials CHECK ((email IS NULL) = (password_hash IS NULL)),
ADD CONSTRAINT users_managed CHECK ((email IS NULL) = (managed_by IS NOT NULL));

CREATE INDEX users_managed_by_idx ON users (managed_by)
WHERE managed_by IS NOT NULL;

-- Whether account $2 writes the data of user $1: their own, or a profile they
-- manage.
CREATE FUNCTION acts_for(UUID, UUID) RETURNS BOOLEAN
LANGUAGE sql
STABLE
PARALLEL SAFE
RETURN coalesce($2 IN (
    $1,
    (
        SELECT u.managed_by FROM users AS u
        WHERE u.id = $1
    )
), FALSE);
