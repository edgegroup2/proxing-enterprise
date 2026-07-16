BEGIN;

CREATE TABLE IF NOT EXISTS school_exam_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES school_exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,

  started_at timestamp without time zone NOT NULL DEFAULT now(),
  submitted_at timestamp without time zone,
  expires_at timestamp without time zone,

  status text NOT NULL DEFAULT 'in_progress',

  objective_score numeric(10,2) NOT NULL DEFAULT 0,
  theory_score numeric(10,2) NOT NULL DEFAULT 0,
  total_score numeric(10,2) NOT NULL DEFAULT 0,
  total_marks numeric(10,2) NOT NULL DEFAULT 0,
  percentage numeric(5,2) NOT NULL DEFAULT 0,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),

  CONSTRAINT school_exam_sessions_status_check
    CHECK (status IN ('in_progress','submitted','auto_submitted','marked','cancelled')),

  CONSTRAINT school_exam_sessions_unique_attempt
    UNIQUE (school_id, exam_id, student_id)
);

CREATE TABLE IF NOT EXISTS school_exam_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES school_exam_sessions(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES school_exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES school_question_bank(id) ON DELETE CASCADE,

  answer jsonb,
  answer_text text,

  is_correct boolean,
  auto_score numeric(10,2) NOT NULL DEFAULT 0,
  manual_score numeric(10,2),
  final_score numeric(10,2) NOT NULL DEFAULT 0,

  marker_member_id uuid REFERENCES school_members(id) ON DELETE SET NULL,
  marker_comment text,

  status text NOT NULL DEFAULT 'saved',

  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),

  CONSTRAINT school_exam_answers_status_check
    CHECK (status IN ('saved','submitted','auto_marked','needs_manual_marking','marked')),

  CONSTRAINT school_exam_answers_unique
    UNIQUE (session_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_school_exam_sessions_school ON school_exam_sessions(school_id);
CREATE INDEX IF NOT EXISTS idx_school_exam_sessions_exam ON school_exam_sessions(exam_id);
CREATE INDEX IF NOT EXISTS idx_school_exam_sessions_student ON school_exam_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_school_exam_sessions_status ON school_exam_sessions(status);

CREATE INDEX IF NOT EXISTS idx_school_exam_answers_session ON school_exam_answers(session_id);
CREATE INDEX IF NOT EXISTS idx_school_exam_answers_exam ON school_exam_answers(exam_id);
CREATE INDEX IF NOT EXISTS idx_school_exam_answers_student ON school_exam_answers(student_id);
CREATE INDEX IF NOT EXISTS idx_school_exam_answers_question ON school_exam_answers(question_id);
CREATE INDEX IF NOT EXISTS idx_school_exam_answers_status ON school_exam_answers(status);

COMMIT;
