-- An exercise lists the grips it can be done with, possibly none, and a
-- default one when it lists any; each block or template exercise records the
-- one chosen, or none when it is not known.
ALTER TABLE exercises
ADD COLUMN grips TEXT[] NOT NULL DEFAULT '{}' CHECK (
    grips <@ ARRAY['pronation', 'supination', 'neutral', 'mixed'] AND all_distinct(grips)
),
ADD COLUMN default_grip TEXT,
ADD CONSTRAINT exercises_default_grip_check CHECK (
    CASE
        WHEN default_grip IS NULL THEN cardinality(grips) = 0
        ELSE default_grip = any(grips)
    END
);

ALTER TABLE template_block_exercises
ADD COLUMN grip TEXT CHECK (grip IN ('pronation', 'supination', 'neutral', 'mixed'));

ALTER TABLE block_exercises
ADD COLUMN grip TEXT CHECK (grip IN ('pronation', 'supination', 'neutral', 'mixed'));

-- Catalog exercises whose grip changes the load they are done with. They are
-- found by their seeded French names, so one a super admin renamed is left as
-- it is.
UPDATE exercises AS e
SET
    grips = v.grips,
    default_grip = v.default_grip
FROM (
    VALUES
    ('Tractions', ARRAY['pronation', 'supination', 'neutral'], 'pronation'),
    ('Tirage vertical', ARRAY['pronation', 'supination', 'neutral'], 'pronation'),
    ('Tirage horizontal', ARRAY['pronation', 'supination', 'neutral'], 'neutral'),
    ('Rowing barre', ARRAY['pronation', 'supination'], 'pronation'),
    ('Curl biceps', ARRAY['pronation', 'supination', 'neutral'], 'supination'),
    ('Extension triceps poulie', ARRAY['pronation', 'neutral'], 'pronation'),
    ('Soulevé de terre', ARRAY['pronation', 'mixed'], 'pronation')
) AS v (name_fr, grips, default_grip)
WHERE
    e.owner_id IS NULL
    AND e.name_fr = v.name_fr
    AND cardinality(e.grips) = 0;

-- The hammer curl becomes the biceps curl done with a neutral grip. Its
-- workouts and templates keep their mode and equipment, which the biceps curl
-- takes on, and record the neutral grip. Nothing happens when either exercise
-- was renamed or deleted, or when the biceps curl offers no neutral grip.
CREATE TEMPORARY TABLE exercise_merges ON COMMIT DROP AS
SELECT
    kept.id AS kept_id,
    dropped.id AS dropped_id,
    array(SELECT DISTINCT unnest(kept.modes || dropped.modes)) AS modes,
    array(SELECT DISTINCT unnest(kept.equipment || dropped.equipment)) AS equipment
FROM exercises AS kept
INNER JOIN exercises AS dropped
    ON dropped.owner_id IS NULL AND dropped.name_fr = 'Curl marteau'
WHERE
    kept.owner_id IS NULL
    AND kept.name_fr = 'Curl biceps'
    AND 'neutral' = any(kept.grips);

UPDATE exercises AS e
SET
    modes = m.modes,
    equipment = m.equipment
FROM exercise_merges AS m
WHERE e.id = m.kept_id;

UPDATE block_exercises AS be
SET
    exercise_id = m.kept_id,
    grip = 'neutral'
FROM exercise_merges AS m
WHERE be.exercise_id = m.dropped_id;

UPDATE template_block_exercises AS tbe
SET
    exercise_id = m.kept_id,
    grip = 'neutral'
FROM exercise_merges AS m
WHERE tbe.exercise_id = m.dropped_id;

DELETE FROM exercises AS e
USING exercise_merges AS m
WHERE e.id = m.dropped_id;
