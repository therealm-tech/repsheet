-- The sets a coach plans for an exercise of a planned session, round by
-- round, in the shape of the logged ones. They stay out of workout_sets, so
-- that nothing planned ever counts as performed.
CREATE TABLE template_block_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_block_exercise_id UUID NOT NULL
    REFERENCES template_block_exercises (id) ON DELETE CASCADE,
    round INTEGER NOT NULL CHECK (round > 0),
    reps INTEGER CHECK (reps >= 0),
    weight_kg DOUBLE PRECISION,
    duration_seconds INTEGER CHECK (duration_seconds >= 0),
    distance_meters INTEGER CHECK (distance_meters >= 0),
    warmup BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX template_block_sets_exercise_id_idx
ON template_block_sets (template_block_exercise_id);

-- A planned session is a draft its athlete does not see until its author
-- sends it. The sessions planned before drafts existed were already visible.
ALTER TABLE templates
ADD COLUMN sent_at TIMESTAMPTZ,
ADD CONSTRAINT templates_sent_at_planned CHECK (sent_at IS NULL OR planned_on IS NOT NULL);

UPDATE templates SET sent_at = created_at
WHERE planned_on IS NOT NULL;

-- Whether coach $3 reads workout $1, logged from template $2: shared with
-- them, or logged from a session they planned. The coaching link is checked
-- apart.
CREATE FUNCTION coach_reads_workout(UUID, UUID, UUID) RETURNS BOOLEAN
LANGUAGE sql
STABLE
PARALLEL SAFE
RETURN EXISTS (
    SELECT 1 FROM workout_shares AS ws
    WHERE ws.workout_id = $1 AND ws.coach_id = $3
)
OR EXISTS (
    SELECT 1 FROM templates AS t
    WHERE t.id = $2 AND t.planned_on IS NOT NULL AND t.author_id = $3
);
