BEGIN;

CREATE TABLE IF NOT EXISTS school_assignment_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL REFERENCES school_assignments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,

  submission_text TEXT,
  attachment_url TEXT,
  attachment_meta JSONB NOT NULL DEFAULT '{}'::jsonb,

  submitted_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),

  score NUMERIC(10,2),
  feedback TEXT,
  graded_by_member_id UUID REFERENCES school_members(id) ON DELETE SET NULL,
  graded_at TIMESTAMP WITHOUT TIME ZONE,

  ai_score NUMERIC(10,2),
  ai_feedback TEXT,

  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('draft','submitted','late','graded','returned','resubmitted')),

  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITHOUT TIME ZONE,

  CONSTRAINT school_assignment_submissions_unique
    UNIQUE (assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_school_assignment_submissions_school
ON school_assignment_submissions(school_id);

CREATE INDEX IF NOT EXISTS idx_school_assignment_submissions_assignment
ON school_assignment_submissions(assignment_id);

CREATE INDEX IF NOT EXISTS idx_school_assignment_submissions_student
ON school_assignment_submissions(student_id);

CREATE INDEX IF NOT EXISTS idx_school_assignment_submissions_status
ON school_assignment_submissions(status);

COMMIT;
