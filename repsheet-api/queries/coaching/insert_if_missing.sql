INSERT INTO coaching_links (athlete_id, coach_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;
