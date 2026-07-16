BEGIN;

CREATE TABLE IF NOT EXISTS school_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id UUID REFERENCES school_classes(id) ON DELETE SET NULL,
  student_id UUID NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  teacher_member_id UUID REFERENCES school_members(id) ON DELETE SET NULL,

  attendance_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'present'
    CHECK (status IN ('present','absent','late','excused')),

  check_in_time TIME,
  remark TEXT,

  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITHOUT TIME ZONE,

  UNIQUE (school_id, student_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_school_attendance_school
ON school_attendance(school_id);

CREATE INDEX IF NOT EXISTS idx_school_attendance_class
ON school_attendance(class_id);

CREATE INDEX IF NOT EXISTS idx_school_attendance_student
ON school_attendance(student_id);

CREATE INDEX IF NOT EXISTS idx_school_attendance_date
ON school_attendance(attendance_date);

CREATE INDEX IF NOT EXISTS idx_school_attendance_status
ON school_attendance(status);

COMMIT;
