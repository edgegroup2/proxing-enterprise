BEGIN;

CREATE TABLE IF NOT EXISTS school_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,

  admission_number text,
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,

  gender text,
  date_of_birth date,

  class_name text,
  department text,

  guardian_name text,
  guardian_phone text,
  guardian_email text,

  photo_url text,

  status text NOT NULL DEFAULT 'active',
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  deleted_at timestamp without time zone,

  CONSTRAINT school_students_status_check
    CHECK (status IN ('active', 'suspended', 'graduated', 'transferred', 'archived')),

  CONSTRAINT school_students_gender_check
    CHECK (gender IS NULL OR gender IN ('male', 'female', 'other')),

  CONSTRAINT school_students_admission_unique
    UNIQUE (school_id, admission_number)
);

CREATE INDEX IF NOT EXISTS idx_school_students_school_id
  ON school_students(school_id);

CREATE INDEX IF NOT EXISTS idx_school_students_status
  ON school_students(status);

CREATE INDEX IF NOT EXISTS idx_school_students_name
  ON school_students(first_name, last_name);

COMMIT;
