-- Starts the thread of each exercise of block $1 with the note its coach
-- wrote for it in the planned block $2 it is logged from. Exercises match by
-- their rank among those of the same exercise, so that one added or removed
-- around them leaves the others matched.
WITH logged AS (
    SELECT
        id,
        exercise_id,
        row_number() OVER (PARTITION BY exercise_id ORDER BY position) AS nth
    FROM block_exercises
    WHERE block_id = $1
),

planned AS (
    SELECT
        template_block_id,
        exercise_id,
        note,
        row_number() OVER (PARTITION BY exercise_id ORDER BY position) AS nth
    FROM template_block_exercises
    WHERE template_block_id = $2
)

INSERT INTO block_exercise_comments (block_exercise_id, author_id, text)
SELECT
    logged.id,
    t.author_id,
    planned.note
FROM logged
INNER JOIN planned ON logged.exercise_id = planned.exercise_id AND logged.nth = planned.nth
INNER JOIN template_blocks AS tb ON planned.template_block_id = tb.id
INNER JOIN templates AS t ON tb.template_id = t.id
WHERE planned.note IS NOT NULL AND t.planned_on IS NOT NULL;
