-- Existing unowned reviews remain visible, but cannot be claimed by a browser.
ALTER TABLE course_reviews ADD COLUMN visitor_id TEXT CHECK (visitor_id IS NULL OR length(visitor_id)=36);
ALTER TABLE course_reviews ADD COLUMN term TEXT CHECK (term IS NULL OR (length(term)=6 AND term GLOB '20[0-9][0-9]-[12]'));
ALTER TABLE course_reviews ADD COLUMN teacher_name TEXT CHECK (teacher_name IS NULL OR length(trim(teacher_name)) BETWEEN 1 AND 80);
ALTER TABLE course_reviews ADD COLUMN updated_at TEXT;
ALTER TABLE course_reviews ADD COLUMN withdrawn_at TEXT;
ALTER TABLE course_reviews ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision>=0);
ALTER TABLE course_reviews ADD COLUMN moderation_id TEXT;
CREATE UNIQUE INDEX idx_course_review_owner ON course_reviews(course_id, visitor_id) WHERE visitor_id IS NOT NULL;

ALTER TABLE teacher_reviews ADD COLUMN visitor_id TEXT CHECK (visitor_id IS NULL OR length(visitor_id)=36);
ALTER TABLE teacher_reviews ADD COLUMN term TEXT CHECK (term IS NULL OR (length(term)=6 AND term GLOB '20[0-9][0-9]-[12]'));
ALTER TABLE teacher_reviews ADD COLUMN teacher_name TEXT CHECK (teacher_name IS NULL OR length(trim(teacher_name)) BETWEEN 1 AND 80);
ALTER TABLE teacher_reviews ADD COLUMN updated_at TEXT;
ALTER TABLE teacher_reviews ADD COLUMN withdrawn_at TEXT;
ALTER TABLE teacher_reviews ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision>=0);
ALTER TABLE teacher_reviews ADD COLUMN moderation_id TEXT;
CREATE UNIQUE INDEX idx_teacher_review_owner ON teacher_reviews(teacher_id, visitor_id) WHERE visitor_id IS NOT NULL;

CREATE INDEX idx_materials_plan ON course_materials(kind, program, source_year, course_id);
ALTER TABLE course_review_replies ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision>=0);
ALTER TABLE course_review_replies ADD COLUMN moderation_id TEXT;
ALTER TABLE teacher_review_replies ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision>=0);
ALTER TABLE teacher_review_replies ADD COLUMN moderation_id TEXT;

CREATE TABLE course_supplements (
  id TEXT PRIMARY KEY NOT NULL,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  visitor_id TEXT NOT NULL CHECK (length(visitor_id)=36),
  kind TEXT NOT NULL CHECK (kind IN ('assessment','materials','correction','other')),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  source_url TEXT CHECK (source_url IS NULL OR (length(source_url)<=2048 AND source_url LIKE 'https://%')),
  term TEXT CHECK (term IS NULL OR (length(term)=6 AND term GLOB '20[0-9][0-9]-[12]')),
  teacher_name TEXT CHECK (teacher_name IS NULL OR length(trim(teacher_name)) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision>=0),
  moderation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX idx_supplements_public ON course_supplements(course_id,status,created_at,id);

CREATE TABLE content_reports (
  id TEXT PRIMARY KEY NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('course_review','teacher_review','course_reply','teacher_reply','supplement')),
  target_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL CHECK (length(visitor_id)=36),
  reason TEXT NOT NULL CHECK (reason IN ('spam','abuse','personal_info','inaccurate','other')),
  details TEXT NOT NULL CHECK (length(details)<=1000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision>=0),
  moderation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (target_kind,target_id,visitor_id)
) STRICT;
CREATE INDEX idx_reports_queue ON content_reports(status,created_at);

CREATE TABLE moderation_actions (
  id TEXT PRIMARY KEY NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
