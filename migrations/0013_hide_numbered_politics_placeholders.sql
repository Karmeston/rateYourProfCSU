-- Keep the original plan records and any reviews for these entries.
UPDATE courses
SET is_listed = 0
WHERE is_listed = 1
  AND (code, name) IN (('210105T10', '思政课4'), ('210203T10', '思政课6'));
