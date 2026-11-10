-- An athlete grants a coach access by adding a link; removing it revokes the
-- access at once. The link carries no state of its own: there is nothing to
-- accept.
CREATE TABLE coaching_links (
    athlete_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    coach_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (athlete_id, coach_id),
    CHECK (athlete_id <> coach_id)
);

CREATE INDEX coaching_links_coach_id_idx ON coaching_links (coach_id);

-- A planned session is a template dated for the day it is planned on,
-- written by a coach for the athlete who owns it. It outlives its author and
-- the coaching link.
ALTER TABLE templates
ADD COLUMN planned_on DATE,
ADD COLUMN author_id UUID REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX templates_user_id_planned_on_idx
ON templates (user_id, planned_on DESC)
WHERE planned_on IS NOT NULL;

CREATE INDEX templates_author_id_idx ON templates (author_id)
WHERE author_id IS NOT NULL;

CREATE INDEX workouts_template_id_idx ON workouts (template_id)
WHERE template_id IS NOT NULL;

-- An athlete shares a workout with one of their coaches; a coach reads it
-- only while the coaching link exists, and removing the coach removes their
-- shares.
CREATE TABLE workout_shares (
    workout_id UUID NOT NULL REFERENCES workouts (id) ON DELETE CASCADE,
    coach_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workout_id, coach_id)
);

CREATE INDEX workout_shares_coach_id_idx ON workout_shares (coach_id);
