BEGIN;

CREATE TABLE IF NOT EXISTS school_fee_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  code TEXT,
  description TEXT,

  is_optional BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','archived')),

  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITHOUT TIME ZONE,

  UNIQUE (school_id, name)
);

CREATE INDEX IF NOT EXISTS idx_school_fee_categories_school
ON school_fee_categories(school_id);

CREATE INDEX IF NOT EXISTS idx_school_fee_categories_status
ON school_fee_categories(status);

COMMIT;
