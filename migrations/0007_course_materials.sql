-- Versioned documentary evidence, not a statement of current offerings or eligibility.
CREATE TABLE course_materials (
  id TEXT PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('syllabus', 'curriculum')),
  source_year INTEGER NOT NULL CHECK (source_year BETWEEN 2000 AND 2100),
  department TEXT NOT NULL CHECK (length(trim(department)) BETWEEN 1 AND 100),
  program TEXT,
  credits REAL CHECK (credits IS NULL OR (credits >= 0 AND credits <= 40)),
  requirement TEXT CHECK (requirement IS NULL OR requirement IN ('必修', '选修')),
  source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%'),
  source_label TEXT NOT NULL CHECK (length(trim(source_label)) > 0),
  source_locator TEXT NOT NULL CHECK (length(trim(source_locator)) > 0)
) STRICT;

CREATE INDEX idx_course_materials_course ON course_materials(course_id, kind, source_year);
