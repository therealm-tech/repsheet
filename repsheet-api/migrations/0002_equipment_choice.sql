-- An exercise lists the equipment it can be done with and a default one; each
-- block or template exercise records the one chosen, as it does its mode.
ALTER TABLE exercises DROP CONSTRAINT exercises_equipment_check;

ALTER TABLE exercises ADD COLUMN default_equipment TEXT;

UPDATE exercises SET default_equipment = equipment;

ALTER TABLE exercises
ALTER COLUMN equipment TYPE TEXT[] USING ARRAY[equipment],
ALTER COLUMN default_equipment SET NOT NULL,
ADD CONSTRAINT exercises_equipment_check CHECK (
    cardinality(equipment) > 0
    AND equipment <@ ARRAY[
        'barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'bodyweight', 'other'
    ]
    AND all_distinct(equipment)
),
ADD CONSTRAINT exercises_default_equipment_check CHECK (default_equipment = any(equipment));

ALTER TABLE template_block_exercises ADD COLUMN equipment TEXT;

UPDATE template_block_exercises AS tbe
SET equipment = e.default_equipment
FROM exercises AS e
WHERE tbe.exercise_id = e.id;

ALTER TABLE template_block_exercises
ALTER COLUMN equipment SET NOT NULL,
ADD CONSTRAINT template_block_exercises_equipment_check CHECK (
    equipment IN (
        'barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'bodyweight', 'other'
    )
);

ALTER TABLE block_exercises ADD COLUMN equipment TEXT;

UPDATE block_exercises AS be
SET equipment = e.default_equipment
FROM exercises AS e
WHERE be.exercise_id = e.id;

ALTER TABLE block_exercises
ALTER COLUMN equipment SET NOT NULL,
ADD CONSTRAINT block_exercises_equipment_check CHECK (
    equipment IN (
        'barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'bodyweight', 'other'
    )
);

-- The catalog's barbell and dumbbell variants of a movement become one
-- exercise offering both. Pairs are found by their seeded French names, so a
-- pair a super admin renamed, deleted or set to the same equipment is left as
-- it is. The merged exercise keeps the modes of both, which the workouts and
-- templates of the dropped variant were counted in, and keeps its own name in
-- a language where another catalog exercise already has the new one.
CREATE TEMPORARY TABLE exercise_merges ON COMMIT DROP AS
SELECT
    kept.id AS kept_id,
    dropped.id AS dropped_id,
    dropped.default_equipment AS equipment,
    array(SELECT DISTINCT unnest(kept.modes || dropped.modes)) AS modes,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM exercises AS other
            WHERE
                other.owner_id IS NULL
                AND other.id NOT IN (kept.id, dropped.id)
                AND fold(other.name_fr) = fold(v.name_fr)
        ) THEN kept.name_fr
        ELSE v.name_fr
    END AS name_fr,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM exercises AS other
            WHERE
                other.owner_id IS NULL
                AND other.id NOT IN (kept.id, dropped.id)
                AND fold(other.name_en) = fold(v.name_en)
        ) THEN kept.name_en
        ELSE v.name_en
    END AS name_en
FROM (
    VALUES
    ('Développé couché', 'Développé couché haltères', 'Développé couché', 'Bench press'),
    (
        'Développé incliné', 'Développé incliné haltères',
        'Développé incliné', 'Incline bench press'
    ),
    (
        'Développé militaire', 'Développé épaules haltères',
        'Développé militaire', 'Overhead press'
    ),
    ('Curl biceps barre', 'Curl biceps haltères', 'Curl biceps', 'Biceps curl')
) AS v (kept_name, dropped_name, name_fr, name_en)
INNER JOIN exercises AS kept ON kept.owner_id IS NULL AND v.kept_name = kept.name_fr
INNER JOIN exercises AS dropped ON dropped.owner_id IS NULL AND v.dropped_name = dropped.name_fr
WHERE kept.default_equipment <> dropped.default_equipment;

UPDATE exercises AS e
SET
    equipment = e.equipment || m.equipment,
    modes = m.modes
FROM exercise_merges AS m
WHERE e.id = m.kept_id;

-- The workouts and templates of the dropped variant keep its equipment, set
-- by the backfill above.
UPDATE block_exercises AS be
SET exercise_id = m.kept_id
FROM exercise_merges AS m
WHERE be.exercise_id = m.dropped_id;

UPDATE template_block_exercises AS tbe
SET exercise_id = m.kept_id
FROM exercise_merges AS m
WHERE tbe.exercise_id = m.dropped_id;

DELETE FROM exercises AS e
USING exercise_merges AS m
WHERE e.id = m.dropped_id;

UPDATE exercises AS e
SET
    name_fr = m.name_fr,
    name_en = m.name_en
FROM exercise_merges AS m
WHERE e.id = m.kept_id;

-- Catalog exercises commonly done with a second kind of equipment.
UPDATE exercises AS e
SET equipment = e.equipment || v.added
FROM (
    VALUES
    ('Fentes', 'barbell'),
    ('Soulevé de terre roumain', 'dumbbell'),
    ('Élévations latérales', 'cable'),
    ('Goblet squat', 'kettlebell'),
    ('Farmer walk', 'kettlebell')
) AS v (name_fr, added)
WHERE
    e.owner_id IS NULL
    AND e.name_fr = v.name_fr
    AND NOT v.added = any(e.equipment);
