-- Course-table query (课表查询) sources carry only code and name, so credits are unknown.
-- Rebuild the provenance table so a timetable source can be stored without inventing credits.
CREATE TABLE course_catalog_records_new (
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
  source_sequence INTEGER NOT NULL CHECK (source_sequence > 0),
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN ('syllabus', 'curriculum', 'execution', 'timetable')),
  source_date TEXT NOT NULL CHECK (source_date GLOB '20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source_url TEXT NOT NULL CHECK (source_url LIKE 'http://csujwc.its.csu.edu.cn/%'),
  source_label TEXT NOT NULL,
  source_page INTEGER CHECK (source_page IS NULL OR source_page > 0),
  department TEXT,
  course_kind TEXT,
  credits REAL CHECK (credits IS NULL OR (credits >= 0 AND credits <= 100)),
  total_hours REAL CHECK (total_hours IS NULL OR (total_hours >= 0 AND total_hours <= 10000)),
  program TEXT,
  source_year INTEGER CHECK (source_year IS NULL OR source_year BETWEEN 2000 AND 2100),
  requirement TEXT CHECK (requirement IS NULL OR requirement IN ('必修', '选修')),
  PRIMARY KEY (source_sha256, source_sequence)
) STRICT;

INSERT INTO course_catalog_records_new (
  source_sha256, source_sequence, course_id, source_type, source_date, source_url, source_label,
  source_page, department, course_kind, credits, total_hours, program, source_year, requirement
)
SELECT
  source_sha256, source_sequence, course_id, source_type, source_date, source_url, source_label,
  source_page, department, course_kind, credits, total_hours, program, source_year, requirement
FROM course_catalog_records;

DROP TABLE course_catalog_records;

ALTER TABLE course_catalog_records_new RENAME TO course_catalog_records;

CREATE INDEX idx_catalog_records_course ON course_catalog_records(course_id);
CREATE INDEX idx_catalog_records_program ON course_catalog_records(program, source_year, course_id);
