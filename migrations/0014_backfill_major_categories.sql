-- Classify visible courses using their already imported curriculum evidence.
UPDATE courses
SET category = 'major'
WHERE is_listed = 1 AND category IS NULL
  AND EXISTS (
    SELECT 1 FROM course_catalog_records p
    WHERE p.course_id = courses.id
      AND (p.course_kind LIKE '学科教育课程%' OR p.course_kind LIKE '专业教育课程%')
  );
