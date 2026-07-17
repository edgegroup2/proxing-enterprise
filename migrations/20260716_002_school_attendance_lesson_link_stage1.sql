BEGIN;

ALTER TABLE school_attendance
  ADD COLUMN IF NOT EXISTS lesson_session_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'school_attendance_lesson_session_id_fkey'
      AND conrelid =
        'public.school_attendance'::regclass
  ) THEN
    ALTER TABLE school_attendance
      ADD CONSTRAINT
        school_attendance_lesson_session_id_fkey
      FOREIGN KEY (lesson_session_id)
      REFERENCES school_lesson_sessions(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS
  school_attendance_lesson_session_idx
ON school_attendance (
  school_id,
  lesson_session_id
)
WHERE lesson_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS
  school_attendance_lesson_student_idx
ON school_attendance (
  school_id,
  lesson_session_id,
  student_id
)
WHERE lesson_session_id IS NOT NULL;

COMMIT;
