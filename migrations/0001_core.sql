-- 课程代码暂时允许未知（NULL）；已知代码不可重复。
CREATE TABLE courses (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE CHECK (code IS NULL OR length(trim(code)) BETWEEN 1 AND 64),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  department TEXT NOT NULL CHECK (length(trim(department)) BETWEEN 1 AND 100)
) STRICT;

-- 姓名不是唯一标识，同名教师使用不同的 id。
CREATE TABLE teachers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  department TEXT NOT NULL CHECK (length(trim(department)) BETWEEN 1 AND 100)
) STRICT;

-- 例如 start_year = 2026, semester = 1 表示 2026–2027 学年第一学期。
-- MVP 暂按两个常规学期建模；短学期需求明确后再迁移扩展。
CREATE TABLE terms (
  id INTEGER PRIMARY KEY,
  start_year INTEGER NOT NULL CHECK (start_year BETWEEN 2000 AND 2100),
  semester INTEGER NOT NULL CHECK (semester IN (1, 2)),
  UNIQUE (start_year, semester)
) STRICT;

-- MVP 按教师、课程、学期聚合，不区分同学期的不同教学班。
-- 未来教学体验通过 course_offering_id 关联这里，而非仅关联教师。
CREATE TABLE course_offerings (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE RESTRICT,
  UNIQUE (course_id, teacher_id, term_id)
) STRICT;

-- 组合唯一索引已覆盖按课程查询；补充教师与学期查询索引。
CREATE INDEX idx_course_offerings_teacher ON course_offerings(teacher_id);
CREATE INDEX idx_course_offerings_term ON course_offerings(term_id);
