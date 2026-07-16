BEGIN;

CREATE TABLE IF NOT EXISTS school_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES school_subjects(id) ON DELETE CASCADE,
  created_by_member_id uuid REFERENCES school_members(id) ON DELETE SET NULL,

  title text NOT NULL,
  exam_type text NOT NULL DEFAULT 'test',
  academic_session text NOT NULL,
  term text,
  duration_minutes integer NOT NULL DEFAULT 60,
  total_marks numeric(10,2) NOT NULL DEFAULT 100,
  instructions text,

  start_at timestamp without time zone,
  end_at timestamp without time zone,

  status text NOT NULL DEFAULT 'draft',

  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  deleted_at timestamp without time zone,

  CONSTRAINT school_exams_status_check
    CHECK (status IN ('draft','published','closed','archived')),

  CONSTRAINT school_exams_type_check
    CHECK (exam_type IN ('test','quiz','assignment','midterm','exam','mock','entrance','other')),

  CONSTRAINT school_exams_duration_check
    CHECK (duration_minutes > 0),

  CONSTRAINT school_exams_total_marks_check
    CHECK (total_marks > 0)
);

CREATE TABLE IF NOT EXISTS school_exam_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES school_exams(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,

  created_at timestamp without time zone NOT NULL DEFAULT now(),

  CONSTRAINT school_exam_classes_unique
    UNIQUE (exam_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_school_exams_school_id ON school_exams(school_id);
CREATE INDEX IF NOT EXISTS idx_school_exams_subject_id ON school_exams(subject_id);
CREATE INDEX IF NOT EXISTS idx_school_exams_status ON school_exams(status);
CREATE INDEX IF NOT EXISTS idx_school_exam_classes_exam_id ON school_exam_classes(exam_id);
CREATE INDEX IF NOT EXISTS idx_school_exam_classes_class_id ON school_exam_classes(class_id);

COMMIT;
