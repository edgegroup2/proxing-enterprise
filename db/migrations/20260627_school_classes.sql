BEGIN;

CREATE TABLE IF NOT EXISTS school_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,

  name text NOT NULL,
  level text,
  arm text,
  class_teacher_member_id uuid REFERENCES school_members(id) ON DELETE SET NULL,

  capacity integer,
  status text NOT NULL DEFAULT 'active',

  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  deleted_at timestamp without time zone,

  CONSTRAINT school_classes_status_check
    CHECK (status IN ('active', 'inactive', 'archived')),

  CONSTRAINT school_classes_capacity_check
    CHECK (capacity IS NULL OR capacity >= 0),

  CONSTRAINT school_classes_unique_name_arm
    UNIQUE (school_id, name, arm)
);

CREATE INDEX IF NOT EXISTS idx_school_classes_school_id
  ON school_classes(school_id);

CREATE INDEX IF NOT EXISTS idx_school_classes_status
  ON school_classes(status);

COMMIT;
