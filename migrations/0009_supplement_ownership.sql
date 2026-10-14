-- Withdrawal preserves content and moderation history. Approval never clears it.
ALTER TABLE course_supplements ADD COLUMN updated_at TEXT;
ALTER TABLE course_supplements ADD COLUMN withdrawn_at TEXT;
CREATE INDEX idx_supplements_owner ON course_supplements(course_id,visitor_id,created_at DESC,id);
