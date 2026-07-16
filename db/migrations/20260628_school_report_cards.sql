BEGIN;

CREATE TABLE IF NOT EXISTS school_report_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  class_id UUID REFERENCES school_classes(id) ON DELETE SET NULL,

  academic_session TEXT NOT NULL,
  term TEXT NOT NULL,

  total_score NUMERIC(10,2) NOT NULL DEFAULT 0,
  average_score NUMERIC(10,2) NOT NULL DEFAULT 0,
  subject_count INTEGER NOT NULL DEFAULT 0,

  grade TEXT,
  position INTEGER,
  promotion_status TEXT DEFAULT 'pending'
    CHECK (promotion_status IN ('pending','promoted','repeated','withdrawn')),

  teacher_comment TEXT,
  principal_comment TEXT,

  generated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  published BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITHOUT TIME ZONE,

  UNIQUE (school_id, student_id, academic_session, term)
);

CREATE INDEX IF NOT EXISTS idx_school_report_cards_school
ON school_report_cards(school_id);

CREATE INDEX IF NOT EXISTS idx_school_report_cards_student
ON school_report_cards(student_id);

CREATE INDEX IF NOT EXISTS idx_school_report_cards_class
ON school_report_cards(class_id);

CREATE INDEX IF NOT EXISTS idx_school_report_cards_session_term
ON school_report_cards(academic_session, term);

COMMIT;
