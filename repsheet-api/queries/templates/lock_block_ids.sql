SELECT id
FROM template_blocks
WHERE template_id = $1
ORDER BY position ASC, id ASC
FOR UPDATE;
