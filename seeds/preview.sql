-- Only for isolated local UI preview. Negative IDs mark every row as fictional.
-- Never run this fixture with --remote.
INSERT INTO courses (id, code, name, department, category) VALUES
  (-101, 'DEMO-MATH-101', '数学分析（一）', '数学与统计学院', 'major'),
  (-102, 'DEMO-MATH-102', '高等代数', '数学与统计学院', 'major'),
  (-103, 'DEMO-MATH-103', '概率论与数理统计', '数学与统计学院', 'major'),
  (-104, 'DEMO-CS-104', '程序设计基础（Python）', '计算机学院', 'major'),
  (-105, 'DEMO-CHEM-105', '名侦探柯南与化学探秘', '化学化工学院', 'elective'),
  (-106, 'DEMO-ART-106', '艺术导论', '建筑与艺术学院', 'elective'),
  (-107, 'DEMO-PHYS-107', '大学物理', '物理学院', 'major'),
  (-108, 'DEMO-SAFE-108', '大学生安全文化', '资源与安全工程学院', 'elective')
ON CONFLICT(id) DO NOTHING;
INSERT INTO elective_course_facts (course_id, elective_type, credits, source_url, source_label, source_locator) VALUES
  (-105, 'natural_science', 2, 'https://example.invalid/elective-preview', '虚构演示资料', '演示课程，不作选课依据'),
  (-106, 'arts_sports', 2, 'https://example.invalid/elective-preview', '虚构演示资料', '演示课程，不作选课依据')
ON CONFLICT(course_id) DO NOTHING;
INSERT INTO course_reviews (id, course_id, rating, body, status, created_at) VALUES
  ('preview-review-1', -101, 5, '演示评价：概念之间的联系讲得很清楚。建议课前预习定义，课后认真完成习题，逐渐会找到分析问题的方法。', 'published', '2026-10-05T10:00:00Z'),
  ('preview-review-2', -101, 4, '演示评价：课程需要持续投入，证明题开始有些难。和同学讨论之后收获很大，别把问题留到期末。', 'published', '2026-10-07T09:30:00Z'),
  ('preview-review-3', -101, 3, '演示评价：内容扎实，节奏较快，需要为练习留出时间。', 'published', '2026-10-08T08:00:00Z'),
  ('preview-review-4', -102, 4, '演示评价：从线性方程组理解抽象概念很有帮助。', 'published', '2026-10-05T10:00:00Z'),
  ('preview-review-5', -103, 4, '演示评价：例题贴近生活，课后多练习不同分布的辨析。', 'published', '2026-10-06T10:00:00Z'),
  ('preview-review-6', -104, 5, '演示评价：实践项目很有趣，编程需要边写边调试。', 'published', '2026-10-07T10:00:00Z'),
  ('preview-review-7', -105, 5, '演示评价：用熟悉的故事理解化学现象，适合拓宽知识面。', 'published', '2026-10-06T10:00:00Z'),
  ('preview-review-8', -106, 4, '演示评价：从不同作品出发理解艺术，课堂讨论很有启发。', 'published', '2026-10-04T10:00:00Z')
ON CONFLICT(id) DO NOTHING;
