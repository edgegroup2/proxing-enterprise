BEGIN;

CREATE TABLE IF NOT EXISTS school_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,

  name text NOT NULL,
  code text,
  category text,
  description text,
  status text NOT NULL DEFAULT 'active',

  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  deleted_at timestamp without time zone,

  CONSTRAINT school_subjects_status_check
    CHECK (status IN ('active', 'inactive', 'archived')),

  CONSTRAINT school_subjects_unique_name
    UNIQUE (school_id, name),

  CONSTRAINT school_subjects_unique_code
    UNIQUE (school_id, code)
);

CREATE INDEX IF NOT EXISTS idx_school_subjects_school_id
  ON school_subjects(school_id);

CREATE INDEX IF NOT EXISTS idx_school_subjects_status
  ON school_subjects(status);

CREATE INDEX IF NOT EXISTS idx_school_subjects_category
  ON school_subjects(category);

COMMIT;
