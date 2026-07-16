BEGIN;

CREATE TABLE IF NOT EXISTS school_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES school_exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES school_subjects(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  teacher_member_id uuid REFERENCES school_members(id) ON DELETE SET NULL,

  score numeric(10,2) NOT NULL,
  grade text,
  remark text,
  status text NOT NULL DEFAULT 'recorded',

  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  deleted_at timestamp without time zone,

  CONSTRAINT school_results_score_check CHECK (score >= 0),
  CONSTRAINT school_results_status_check CHECK (status IN ('recorded','approved','published','archived')),
  CONSTRAINT school_results_unique_student_exam_subject UNIQUE (school_id, exam_id, student_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_school_results_school_id ON school_results(school_id);
CREATE INDEX IF NOT EXISTS idx_school_results_exam_id ON school_results(exam_id);
CREATE INDEX IF NOT EXISTS idx_school_results_student_id ON school_results(student_id);
CREATE INDEX IF NOT EXISTS idx_school_results_class_id ON school_results(class_id);
CREATE INDEX IF NOT EXISTS idx_school_results_subject_id ON school_results(subject_id);

COMMIT;
