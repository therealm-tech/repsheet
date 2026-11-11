-- A one-time link that turns a profile into an account. A profile has at
-- most one live invitation: a new one replaces it. Only the token's SHA-256
-- is kept, as for access tokens.
CREATE TABLE athlete_invitations (
    athlete_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);
