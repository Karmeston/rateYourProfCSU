-- 教师独立浏览所需的官网链接。既有授课和学期数据保留，但不再作为浏览或评价的前提。
ALTER TABLE teachers ADD COLUMN profile_url TEXT
  CHECK (profile_url IS NULL OR (length(profile_url) <= 2048 AND profile_url GLOB 'https://*'));
