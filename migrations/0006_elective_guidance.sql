-- Course facts and term offerings are separate: an old syllabus does not prove a new offering.
CREATE TABLE elective_course_facts (
  course_id INTEGER PRIMARY KEY REFERENCES courses(id) ON DELETE RESTRICT,
  elective_type TEXT CHECK (elective_type IN ('natural_science', 'humanities', 'economics', 'arts_sports')),
  credits REAL CHECK (credits > 0 AND credits <= 30),
  applicable_programs TEXT CHECK (length(trim(applicable_programs)) BETWEEN 1 AND 2000),
  source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%' AND length(source_url) <= 2000),
  source_label TEXT NOT NULL CHECK (length(trim(source_label)) BETWEEN 1 AND 200),
  source_locator TEXT NOT NULL CHECK (length(trim(source_locator)) BETWEEN 1 AND 500)
) STRICT;

CREATE TABLE elective_course_offerings (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  start_year INTEGER NOT NULL CHECK (start_year BETWEEN 2000 AND 2100),
  semester INTEGER NOT NULL CHECK (semester IN (1, 2)),
  mode TEXT NOT NULL CHECK (mode IN ('mooc', 'classroom')),
  platform TEXT CHECK (length(trim(platform)) BETWEEN 1 AND 100),
  origin_university TEXT CHECK (length(trim(origin_university)) BETWEEN 1 AND 100),
  source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%' AND length(source_url) <= 2000),
  source_label TEXT NOT NULL CHECK (length(trim(source_label)) BETWEEN 1 AND 200),
  source_locator TEXT NOT NULL CHECK (length(trim(source_locator)) BETWEEN 1 AND 500),
  PRIMARY KEY (course_id, start_year, semester)
) STRICT;

-- One module's decision does not decide enrollment, total graduation credits or grades.
-- Multiple sources remain separate so contradictory decisions can be shown as unresolved.
CREATE TABLE elective_credit_rules (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  plan_id TEXT NOT NULL CHECK (length(trim(plan_id)) BETWEEN 1 AND 100),
  module TEXT NOT NULL CHECK (module IN ('art', 'cross_discipline')),
  outcome TEXT NOT NULL CHECK (outcome IN ('counts', 'not_counts')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%' AND length(source_url) <= 2000),
  source_label TEXT NOT NULL CHECK (length(trim(source_label)) BETWEEN 1 AND 200),
  source_locator TEXT NOT NULL CHECK (length(trim(source_locator)) BETWEEN 1 AND 500),
  UNIQUE (course_id, plan_id, module, source_url, source_locator, outcome)
) STRICT;
