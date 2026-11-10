-- A block exercise carries a thread of comments, written by the athlete and by
-- the coaches who read the workout. A comment outlives its author's account.
CREATE TABLE block_exercise_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    block_exercise_id UUID NOT NULL REFERENCES block_exercises (id) ON DELETE CASCADE,
    author_id UUID REFERENCES users (id) ON DELETE SET NULL,
    text TEXT NOT NULL CHECK (text <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX block_exercise_comments_block_exercise_id_idx
ON block_exercise_comments (block_exercise_id, created_at);

CREATE INDEX block_exercise_comments_author_id_idx ON block_exercise_comments (author_id)
WHERE author_id IS NOT NULL;
