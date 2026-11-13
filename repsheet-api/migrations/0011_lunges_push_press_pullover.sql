-- Reverse, forward and static lunges, the push press and the pullover join the
-- catalog as movements of their own, so their loads keep their own history
-- instead of being logged under another exercise. A catalog exercise a super
-- admin already gave one of these names is kept.
INSERT INTO exercises (
    name_fr, name_en, modes, default_mode, load, equipment, default_equipment, unilateral
) VALUES
(
    'Fentes arrière', 'Reverse lunges', ARRAY['reps'], 'reps', 'required',
    ARRAY['dumbbell', 'barbell'], 'dumbbell', TRUE
),
(
    'Fentes avant', 'Forward lunges', ARRAY['reps'], 'reps', 'required',
    ARRAY['dumbbell', 'barbell'], 'dumbbell', TRUE
),
(
    'Fentes statiques', 'Static lunges', ARRAY['reps'], 'reps', 'required',
    ARRAY['dumbbell', 'barbell'], 'dumbbell', TRUE
),
(
    'Push press', 'Push press', ARRAY['reps'], 'reps', 'required',
    ARRAY['barbell', 'dumbbell'], 'barbell', FALSE
),
(
    'Pull over', 'Pullover', ARRAY['reps'], 'reps', 'required',
    ARRAY['dumbbell', 'cable'], 'dumbbell', FALSE
)
ON CONFLICT DO NOTHING;
