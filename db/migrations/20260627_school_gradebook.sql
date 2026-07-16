BEGIN;

CREATE TABLE IF NOT EXISTS school_gradebook_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id UUID REFERENCES school_classes(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES school_subjects(id) ON DELETE SET NULL,
  student_id UUID REFERENCES school_students(id) ON DELETE CASCADE,
  teacher_member_id UUID REFERENCES school_members(id) ON DELETE SET NULL,

  academic_session TEXT NOT NULL,
  term TEXT NOT NULL,

  assessment_type TEXT NOT NULL DEFAULT 'exam'
    CHECK (assessment_type IN ('ca','test','exam','assignment','project','practical','other')),

  title TEXT NOT NULL,
  score NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_score NUMERIC(10,2) NOT NULL DEFAULT 100,

  weight NUMERIC(10,2) NOT NULL DEFAULT 100,
  remark TEXT,

  recorded_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),

  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITHOUT TIME ZONE,

  CHECK (score >= 0),
  CHECK (max_score > 0),
  CHECK (weight > 0)
);

CREATE INDEX IF NOT EXISTS idx_school_gradebook_school
ON school_gradebook_entries(school_id);

CREATE INDEX IF NOT EXISTS idx_school_gradebook_student
ON school_gradebook_entries(student_id);

CREATE INDEX IF NOT EXISTS idx_school_gradebook_class
ON school_gradebook_entries(class_id);

CREATE INDEX IF NOT EXISTS idx_school_gradebook_subject
ON school_gradebook_entries(subject_id);

CREATE INDEX IF NOT EXISTS idx_school_gradebook_session_term
ON school_gradebook_entries(academic_session, term);

COMMIT;
