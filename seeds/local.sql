-- 仅用于本地演示，以下课程、教师及授课关系全部虚构。
-- 使用负数 ID 隔离演示记录；只忽略重复主键，不覆盖现有内容。
INSERT INTO courses (id, code, name, department) VALUES
  (-1, 'DEMO-MATH-001', '演示课程：高等数学', '虚构学院（演示）'),
  (-2, 'DEMO-CS-001', '演示课程：程序设计', '虚构学院（演示）')
ON CONFLICT(id) DO NOTHING;

INSERT INTO teachers (id, name, department) VALUES
  (-1, '虚构教师甲', '虚构学院（演示）'),
  (-2, '虚构教师乙', '虚构学院（演示）')
ON CONFLICT(id) DO NOTHING;

INSERT INTO terms (id, start_year, semester) VALUES
  (-1, 2025, 1),
  (-2, 2026, 1)
ON CONFLICT(id) DO NOTHING;

INSERT INTO course_offerings (id, course_id, teacher_id, term_id) VALUES
  (-1, -1, -1, -1),
  (-2, -1, -1, -2),
  (-3, -1, -2, -2),
  (-4, -2, -2, -2)
ON CONFLICT(id) DO NOTHING;
