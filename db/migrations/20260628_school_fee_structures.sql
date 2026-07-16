BEGIN;

CREATE TABLE IF NOT EXISTS school_fee_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id UUID REFERENCES school_classes(id) ON DELETE SET NULL,
  category_id UUID NOT NULL REFERENCES school_fee_categories(id) ON DELETE CASCADE,

  academic_session TEXT NOT NULL,
  term TEXT NOT NULL,

  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_mandatory BOOLEAN NOT NULL DEFAULT true,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','archived')),

  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITHOUT TIME ZONE,

  UNIQUE (school_id, class_id, category_id, academic_session, term)
);

CREATE INDEX IF NOT EXISTS idx_school_fee_structures_school
ON school_fee_structures(school_id);

CREATE INDEX IF NOT EXISTS idx_school_fee_structures_class
ON school_fee_structures(class_id);

CREATE INDEX IF NOT EXISTS idx_school_fee_structures_category
ON school_fee_structures(category_id);

CREATE INDEX IF NOT EXISTS idx_school_fee_structures_session_term
ON school_fee_structures(academic_session, term);

COMMIT;
