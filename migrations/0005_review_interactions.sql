CREATE TABLE teacher_review_votes (
  review_id TEXT NOT NULL REFERENCES teacher_reviews(id) ON DELETE CASCADE,
  voter_id TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (review_id, voter_id)
) STRICT;
CREATE TABLE teacher_review_replies (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL REFERENCES teacher_reviews(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'pending', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX idx_teacher_replies ON teacher_review_replies(review_id, status, created_at, id);

CREATE TABLE course_review_votes (
  review_id TEXT NOT NULL REFERENCES course_reviews(id) ON DELETE CASCADE,
  voter_id TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (review_id, voter_id)
) STRICT;
CREATE TABLE course_review_replies (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL REFERENCES course_reviews(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'pending', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX idx_course_replies ON course_review_replies(review_id, status, created_at, id);
