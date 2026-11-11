-- The Zottman curl joins the catalog as a movement of its own: lowered
-- pronated, it moves less than a supinated curl, so its loads need their own
-- history. A catalog exercise a super admin already gave either name is kept.
INSERT INTO exercises (
    name_fr, name_en, modes, default_mode, load, equipment, default_equipment, unilateral
) VALUES (
    'Curl Zottman', 'Zottman curl', ARRAY['reps'], 'reps', 'required',
    ARRAY['dumbbell'], 'dumbbell', FALSE
)
ON CONFLICT DO NOTHING;
