ALTER TABLE courses ADD COLUMN category TEXT CHECK (category IN ('major', 'elective'));
ALTER TABLE courses ADD COLUMN is_listed INTEGER NOT NULL DEFAULT 1 CHECK (is_listed IN (0, 1));

UPDATE courses SET category = 'major'
WHERE name IN ('多元统计分析', '复变函数', '随机过程', '统计数据分析', '统计机器学习基础', '回归分析', '贝叶斯统计');

-- 排除思政课程，保留既有记录及评价，不删除数据。
UPDATE courses SET category = NULL, is_listed = 0
WHERE name IN ('形势与政策', '改革开放史', '毛泽东思想和中国特色社会主义理论体系概论');
