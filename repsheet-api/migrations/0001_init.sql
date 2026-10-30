-- Lowercases and strips the French accents, so that "dev" finds "Développé".
CREATE FUNCTION fold(value TEXT) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
RETURN translate(
    lower(value),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœ',
    'aaaaaaceeeeiiiinooooouuuuyyo'
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    weight_unit TEXT NOT NULL CHECK (weight_unit IN ('kg', 'lb')),
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'super_admin')),
    locale TEXT NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'en')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE access_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX access_tokens_user_id_idx ON access_tokens (user_id);

-- The name shown in `locale`, falling back on the other language.
CREATE FUNCTION exercise_name(name_fr TEXT, name_en TEXT, locale TEXT) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN CASE
    WHEN locale = 'en' THEN coalesce(name_en, name_fr)
    ELSE coalesce(name_fr, name_en)
END;

-- Whether no value appears twice in the array.
CREATE FUNCTION all_distinct(vals TEXT[]) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
RETURN cardinality(vals) = (SELECT count(DISTINCT v.val) FROM unnest(vals) AS v (val));

-- owner_id is NULL for the built-in catalog, visible to every user. A
-- built-in exercise is named in both languages; a custom one at least in its
-- owner's. `modes` are the ways a set of it can be counted, `load` whether a
-- set takes no weight, an optional one or a required one.
CREATE TABLE exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users (id) ON DELETE CASCADE,
    name_fr TEXT,
    name_en TEXT,
    modes TEXT[] NOT NULL CHECK (
        cardinality(modes) > 0
        AND modes <@ ARRAY['reps', 'time', 'distance']
        AND all_distinct(modes)
    ),
    default_mode TEXT NOT NULL,
    load TEXT NOT NULL CHECK (load IN ('none', 'optional', 'required')),
    equipment TEXT NOT NULL CHECK (
        equipment IN (
            'barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'bodyweight', 'other'
        )
    ),
    unilateral BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (name_fr IS NOT NULL OR name_en IS NOT NULL),
    CHECK (default_mode = any(modes))
);

CREATE UNIQUE INDEX exercises_builtin_name_fr_key ON exercises (fold(name_fr))
WHERE owner_id IS NULL;

CREATE UNIQUE INDEX exercises_builtin_name_en_key ON exercises (fold(name_en))
WHERE owner_id IS NULL;

CREATE UNIQUE INDEX exercises_owner_name_fr_key ON exercises (owner_id, fold(name_fr))
WHERE owner_id IS NOT NULL;

CREATE UNIQUE INDEX exercises_owner_name_en_key ON exercises (owner_id, fold(name_en))
WHERE owner_id IS NOT NULL;

CREATE TABLE templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX templates_user_id_idx ON templates (user_id);

CREATE TABLE template_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    rounds INTEGER CHECK (rounds > 0),
    rest_seconds INTEGER CHECK (rest_seconds >= 0)
);

CREATE INDEX template_blocks_template_id_idx ON template_blocks (template_id);

CREATE TABLE template_block_exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_block_id UUID NOT NULL REFERENCES template_blocks (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    exercise_id UUID NOT NULL REFERENCES exercises (id),
    mode TEXT NOT NULL CHECK (mode IN ('reps', 'time', 'distance')),
    target TEXT
);

CREATE INDEX template_block_exercises_block_id_idx
ON template_block_exercises (template_block_id);

-- A workout is usually logged after the session: it carries the day it took
-- place on, and created_at orders the workouts of a same day.
CREATE TABLE workouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    template_id UUID REFERENCES templates (id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    note TEXT,
    performed_on DATE NOT NULL,
    duration_minutes INTEGER CHECK (duration_minutes > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workouts_user_id_performed_on_idx
ON workouts (user_id, performed_on DESC, created_at DESC);

CREATE TABLE blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workout_id UUID NOT NULL REFERENCES workouts (id) ON DELETE CASCADE,
    template_block_id UUID REFERENCES template_blocks (id) ON DELETE SET NULL,
    position INTEGER NOT NULL,
    rest_seconds INTEGER CHECK (rest_seconds >= 0)
);

CREATE INDEX blocks_workout_id_idx ON blocks (workout_id);

CREATE TABLE block_exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    block_id UUID NOT NULL REFERENCES blocks (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    exercise_id UUID NOT NULL REFERENCES exercises (id),
    mode TEXT NOT NULL CHECK (mode IN ('reps', 'time', 'distance'))
);

CREATE INDEX block_exercises_block_id_idx ON block_exercises (block_id);

CREATE INDEX block_exercises_exercise_id_idx ON block_exercises (exercise_id);

CREATE TABLE workout_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    block_exercise_id UUID NOT NULL REFERENCES block_exercises (id) ON DELETE CASCADE,
    round INTEGER NOT NULL CHECK (round > 0),
    reps INTEGER CHECK (reps >= 0),
    weight_kg DOUBLE PRECISION,
    duration_seconds INTEGER CHECK (duration_seconds >= 0),
    distance_meters INTEGER CHECK (distance_meters >= 0),
    warmup BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX workout_sets_block_exercise_id_idx ON workout_sets (block_exercise_id);

INSERT INTO exercises (name_fr, name_en, modes, default_mode, load, equipment, unilateral) VALUES
('Développé couché', 'Bench press', ARRAY['reps'], 'reps', 'required', 'barbell', FALSE),
('Développé incliné', 'Incline bench press', ARRAY['reps'], 'reps', 'required', 'barbell', FALSE),
(
    'Développé couché haltères', 'Dumbbell bench press',
    ARRAY['reps'], 'reps', 'required', 'dumbbell', FALSE
),
(
    'Développé incliné haltères', 'Incline dumbbell press',
    ARRAY['reps'], 'reps', 'required', 'dumbbell', FALSE
),
('Développé militaire', 'Overhead press', ARRAY['reps'], 'reps', 'required', 'barbell', FALSE),
(
    'Développé épaules haltères', 'Dumbbell shoulder press',
    ARRAY['reps'], 'reps', 'required', 'dumbbell', FALSE
),
('Développé machine', 'Machine chest press', ARRAY['reps'], 'reps', 'required', 'machine', FALSE),
('Écarté poulie', 'Cable fly', ARRAY['reps'], 'reps', 'required', 'cable', FALSE),
('Écarté haltères', 'Dumbbell fly', ARRAY['reps'], 'reps', 'required', 'dumbbell', FALSE),
('Pompes', 'Push-ups', ARRAY['reps', 'time'], 'reps', 'optional', 'bodyweight', FALSE),
('Dips', 'Dips', ARRAY['reps'], 'reps', 'optional', 'bodyweight', FALSE),
('Élévations latérales', 'Lateral raises', ARRAY['reps'], 'reps', 'required', 'dumbbell', FALSE),
('Oiseau', 'Reverse fly', ARRAY['reps'], 'reps', 'required', 'dumbbell', FALSE),
('Face pull', 'Face pull', ARRAY['reps'], 'reps', 'required', 'cable', FALSE),
('Tractions', 'Pull-ups', ARRAY['reps'], 'reps', 'optional', 'bodyweight', FALSE),
('Tirage vertical', 'Lat pulldown', ARRAY['reps'], 'reps', 'required', 'cable', FALSE),
('Tirage horizontal', 'Seated cable row', ARRAY['reps'], 'reps', 'required', 'cable', FALSE),
('Rowing barre', 'Barbell row', ARRAY['reps'], 'reps', 'required', 'barbell', FALSE),
('Rowing haltère', 'Dumbbell row', ARRAY['reps'], 'reps', 'required', 'dumbbell', TRUE),
('Soulevé de terre', 'Deadlift', ARRAY['reps'], 'reps', 'required', 'barbell', FALSE),
(
    'Soulevé de terre roumain', 'Romanian deadlift',
    ARRAY['reps'], 'reps', 'required', 'barbell', FALSE
),
('Squat', 'Squat', ARRAY['reps'], 'reps', 'required', 'barbell', FALSE),
('Front squat', 'Front squat', ARRAY['reps'], 'reps', 'required', 'barbell', FALSE),
('Goblet squat', 'Goblet squat', ARRAY['reps'], 'reps', 'required', 'dumbbell', FALSE),
('Presse à cuisses', 'Leg press', ARRAY['reps'], 'reps', 'required', 'machine', FALSE),
('Fentes', 'Lunges', ARRAY['reps'], 'reps', 'required', 'dumbbell', TRUE),
('Fentes bulgares', 'Bulgarian split squat', ARRAY['reps'], 'reps', 'required', 'dumbbell', TRUE),
('Hip thrust', 'Hip thrust', ARRAY['reps'], 'reps', 'required', 'barbell', FALSE),
('Leg extension', 'Leg extension', ARRAY['reps'], 'reps', 'required', 'machine', FALSE),
('Leg curl', 'Leg curl', ARRAY['reps'], 'reps', 'required', 'machine', FALSE),
('Mollets debout', 'Standing calf raise', ARRAY['reps'], 'reps', 'required', 'machine', FALSE),
('Curl biceps barre', 'Barbell curl', ARRAY['reps'], 'reps', 'required', 'barbell', FALSE),
('Curl biceps haltères', 'Dumbbell curl', ARRAY['reps'], 'reps', 'required', 'dumbbell', FALSE),
('Curl marteau', 'Hammer curl', ARRAY['reps'], 'reps', 'required', 'dumbbell', FALSE),
(
    'Extension triceps poulie', 'Cable triceps pushdown',
    ARRAY['reps'], 'reps', 'required', 'cable', FALSE
),
('Barre au front', 'Skull crusher', ARRAY['reps'], 'reps', 'required', 'barbell', FALSE),
(
    'Kettlebell swing', 'Kettlebell swing',
    ARRAY['reps', 'time'], 'reps', 'required', 'kettlebell', FALSE
),
('Burpees', 'Burpees', ARRAY['reps', 'time'], 'reps', 'none', 'bodyweight', FALSE),
('Crunch', 'Crunch', ARRAY['reps', 'time'], 'reps', 'none', 'bodyweight', FALSE),
('Relevés de jambes', 'Leg raises', ARRAY['reps', 'time'], 'reps', 'none', 'bodyweight', FALSE),
('Planche', 'Plank', ARRAY['time'], 'time', 'optional', 'bodyweight', FALSE),
('Gainage latéral', 'Side plank', ARRAY['time'], 'time', 'optional', 'bodyweight', TRUE),
('Corde à sauter', 'Jump rope', ARRAY['time'], 'time', 'none', 'other', FALSE),
('Rameur', 'Rowing machine', ARRAY['time', 'distance'], 'distance', 'none', 'machine', FALSE),
(
    'Farmer walk', 'Farmer''s walk',
    ARRAY['time', 'distance'], 'distance', 'required', 'dumbbell', FALSE
);
