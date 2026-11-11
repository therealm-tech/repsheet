-- Uses up the live invitation with token digest $1: returns the profile and
-- its coach, and no row when there is no such invitation.
DELETE FROM athlete_invitations AS i
USING users AS a
WHERE
    i.athlete_id = a.id
    AND i.token_hash = $1
    AND i.expires_at > now()
    AND a.managed_by IS NOT NULL
RETURNING i.athlete_id, a.managed_by AS coach_id;
