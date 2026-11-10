-- Whether block $1 is of a template of account $2 that they see: not of a
-- planned session still a draft.
SELECT EXISTS(
    SELECT 1
    FROM template_blocks AS tb
    INNER JOIN templates AS t ON tb.template_id = t.id
    WHERE
        tb.id = $1
        AND t.user_id = $2
        AND (t.planned_on IS NULL OR t.sent_at IS NOT NULL)
);
