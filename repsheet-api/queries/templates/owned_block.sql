SELECT EXISTS(
    SELECT 1
    FROM template_blocks AS tb
    INNER JOIN templates AS t ON tb.template_id = t.id
    WHERE tb.id = $1 AND t.user_id = $2
);
