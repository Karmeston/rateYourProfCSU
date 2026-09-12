-- 两类评价直接关联教师或课程，不要求课程组合或学期。
CREATE TABLE teacher_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX idx_teacher_reviews_public ON teacher_reviews(teacher_id, status, created_at DESC, id DESC);

CREATE TABLE course_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX idx_course_reviews_public ON course_reviews(course_id, status, created_at DESC, id DESC);
