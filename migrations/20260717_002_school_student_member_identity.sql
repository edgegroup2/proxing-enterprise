BEGIN;

ALTER TABLE school_students
  ADD COLUMN IF NOT EXISTS member_id uuid;

ALTER TABLE school_students
  ADD COLUMN IF NOT EXISTS member_linked_at
    timestamp with time zone;

ALTER TABLE school_students
  ADD COLUMN IF NOT EXISTS member_linked_by_member_id
    uuid;

CREATE UNIQUE INDEX IF NOT EXISTS
  school_members_school_id_id_unique
ON school_members (
  school_id,
  id
);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'school_students_school_member_fkey'
      AND conrelid =
        'school_students'::regclass
  ) THEN
    ALTER TABLE school_students
      ADD CONSTRAINT
        school_students_school_member_fkey
      FOREIGN KEY (
        school_id,
        member_id
      )
      REFERENCES school_members (
        school_id,
        id
      )
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'school_students_school_linked_by_member_fkey'
      AND conrelid =
        'school_students'::regclass
  ) THEN
    ALTER TABLE school_students
      ADD CONSTRAINT
        school_students_school_linked_by_member_fkey
      FOREIGN KEY (
        school_id,
        member_linked_by_member_id
      )
      REFERENCES school_members (
        school_id,
        id
      )
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'school_students_member_link_state_check'
      AND conrelid =
        'school_students'::regclass
  ) THEN
    ALTER TABLE school_students
      ADD CONSTRAINT
        school_students_member_link_state_check
      CHECK (
        (
          member_id IS NULL
          AND member_linked_at IS NULL
          AND member_linked_by_member_id
            IS NULL
        )
        OR
        (
          member_id IS NOT NULL
          AND member_linked_at IS NOT NULL
          AND member_linked_by_member_id
            IS NOT NULL
        )
      );
  END IF;
END
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS
  school_students_active_member_unique
ON school_students (member_id)
WHERE
  member_id IS NOT NULL
  AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS
  school_students_school_member_idx
ON school_students (
  school_id,
  member_id
)
WHERE member_id IS NOT NULL;

COMMIT;
