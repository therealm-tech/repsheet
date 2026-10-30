DELETE FROM template_blocks
WHERE template_id = $1 AND NOT (id = any($2));
