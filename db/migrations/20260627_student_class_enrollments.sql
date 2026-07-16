BEGIN;

CREATE TABLE IF NOT EXISTS student_class_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,

  academic_session text NOT NULL,
  term text,
  status text NOT NULL DEFAULT 'active',

  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  deleted_at timestamp without time zone,

  CONSTRAINT student_class_enrollments_status_check
    CHECK (status IN ('active', 'transferred', 'promoted', 'graduated', 'archived')),

  CONSTRAINT student_class_enrollments_unique_active
    UNIQUE (school_id, student_id, academic_session)
);

CREATE INDEX IF NOT EXISTS idx_student_class_enrollments_school_id
  ON student_class_enrollments(school_id);

CREATE INDEX IF NOT EXISTS idx_student_class_enrollments_student_id
  ON student_class_enrollments(student_id);

CREATE INDEX IF NOT EXISTS idx_student_class_enrollments_class_id
  ON student_class_enrollments(class_id);

CREATE INDEX IF NOT EXISTS idx_student_class_enrollments_status
  ON student_class_enrollments(status);

COMMIT;
