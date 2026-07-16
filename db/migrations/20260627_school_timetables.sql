BEGIN;

CREATE TABLE IF NOT EXISTS school_timetables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES school_subjects(id) ON DELETE CASCADE,
  teacher_member_id uuid REFERENCES school_members(id) ON DELETE SET NULL,

  day_of_week text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  room text,
  note text,

  status text NOT NULL DEFAULT 'active',

  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  deleted_at timestamp without time zone,

  CONSTRAINT school_timetables_day_check
    CHECK (day_of_week IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),

  CONSTRAINT school_timetables_status_check
    CHECK (status IN ('active','inactive','archived')),

  CONSTRAINT school_timetables_time_check
    CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_school_timetables_school_id
  ON school_timetables(school_id);

CREATE INDEX IF NOT EXISTS idx_school_timetables_class_id
  ON school_timetables(class_id);

CREATE INDEX IF NOT EXISTS idx_school_timetables_subject_id
  ON school_timetables(subject_id);

CREATE INDEX IF NOT EXISTS idx_school_timetables_teacher_member_id
  ON school_timetables(teacher_member_id);

CREATE INDEX IF NOT EXISTS idx_school_timetables_day
  ON school_timetables(day_of_week);

COMMIT;
