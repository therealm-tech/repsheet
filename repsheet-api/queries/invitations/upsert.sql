-- $1 profile, $2 token digest, $3 expiry; replaces the profile's invitation.
INSERT INTO athlete_invitations (athlete_id, token_hash, expires_at)
VALUES ($1, $2, $3)
ON CONFLICT (athlete_id) DO UPDATE
    SET
        token_hash = excluded.token_hash,
        created_at = now(),
        expires_at = excluded.expires_at;
