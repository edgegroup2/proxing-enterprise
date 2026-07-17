BEGIN;

ALTER TABLE school_lesson_sessions
  ADD COLUMN IF NOT EXISTS
    academic_session text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'school_lesson_sessions_academic_session_check'
      AND conrelid =
        'school_lesson_sessions'::regclass
  ) THEN
    ALTER TABLE school_lesson_sessions
      ADD CONSTRAINT
        school_lesson_sessions_academic_session_check
      CHECK (
        academic_session IS NULL
        OR (
          btrim(academic_session) <> ''
          AND char_length(
            btrim(academic_session)
          ) <= 100
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS
  school_lesson_sessions_school_academic_session_idx
ON school_lesson_sessions (
  school_id,
  academic_session
)
WHERE academic_session IS NOT NULL;

COMMIT;
