-- The politics exclusion rule missed this wording. Keep the record and any reviews.
UPDATE courses
SET is_listed = 0
WHERE is_listed = 1
  AND code = '2-110'
  AND name = '思想政治理论综合课';
