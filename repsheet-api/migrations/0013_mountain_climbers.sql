-- Mountain climbers join the catalog as a bodyweight conditioning movement,
-- so coaches can pick it instead of every user keeping a personal copy. A
-- catalog exercise a super admin already gave either name is kept.
INSERT INTO exercises (
    name_fr, name_en, modes, default_mode, load, equipment, default_equipment, unilateral
) VALUES (
    'Mountain climbers', 'Mountain climber', ARRAY['reps', 'time'], 'reps', 'none',
    ARRAY['bodyweight'], 'bodyweight', FALSE
)
ON CONFLICT DO NOTHING;
