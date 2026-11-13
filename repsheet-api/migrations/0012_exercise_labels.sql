-- A user's own labels on the exercises they see. A catalog exercise is
-- labelled by each user for themselves. Labels compare through fold(), so
-- `Push` and `push` are one label.
CREATE TABLE exercise_labels (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    exercise_id UUID NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
    label TEXT NOT NULL CHECK (label = btrim(label) AND length(label) BETWEEN 1 AND 30)
);

CREATE UNIQUE INDEX exercise_labels_unique
ON exercise_labels (user_id, exercise_id, fold(label));

CREATE INDEX exercise_labels_by_label
ON exercise_labels (user_id, fold(label));

-- The labels user $2 put on exercise $1, in folded order.
CREATE FUNCTION exercise_labels_of(UUID, UUID) RETURNS TEXT[]
LANGUAGE sql
STABLE
PARALLEL SAFE
RETURN array(
    SELECT el.label
    FROM exercise_labels AS el
    WHERE el.exercise_id = $1 AND el.user_id = $2
    ORDER BY fold(el.label)
);
