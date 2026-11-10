SELECT EXISTS(
    SELECT 1
    FROM coaching_links
    WHERE athlete_id = $1 AND coach_id = $2
);
