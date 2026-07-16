BEGIN;

CREATE TABLE IF NOT EXISTS school_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  teacher_member_id uuid REFERENCES school_members(id) ON DELETE SET NULL,

  attendance_date date NOT NULL,
  status text NOT NULL DEFAULT 'present',
  remark text,

  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  deleted_at timestamp without time zone,

  CONSTRAINT school_attendance_status_check
    CHECK (status IN ('present', 'absent', 'late', 'excused')),

  CONSTRAINT school_attendance_unique_day
    UNIQUE (school_id, class_id, student_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_school_attendance_school_id
  ON school_attendance(school_id);

CREATE INDEX IF NOT EXISTS idx_school_attendance_class_id
  ON school_attendance(class_id);

CREATE INDEX IF NOT EXISTS idx_school_attendance_student_id
  ON school_attendance(student_id);

CREATE INDEX IF NOT EXISTS idx_school_attendance_date
  ON school_attendance(attendance_date);

CREATE INDEX IF NOT EXISTS idx_school_attendance_status
  ON school_attendance(status);

COMMIT;
