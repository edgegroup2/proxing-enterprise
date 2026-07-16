BEGIN;

CREATE TABLE IF NOT EXISTS school_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id UUID REFERENCES school_classes(id) ON DELETE SET NULL,
  created_by_member_id UUID REFERENCES school_members(id) ON DELETE SET NULL,

  title TEXT NOT NULL,
  description TEXT,

  event_type TEXT NOT NULL DEFAULT 'general'
    CHECK (event_type IN ('general','exam','holiday','meeting','deadline','sports','cultural','fee','pta','other')),

  audience TEXT NOT NULL DEFAULT 'school'
    CHECK (audience IN ('school','class','teachers','students','parents')),

  location TEXT,

  starts_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  ends_at TIMESTAMP WITHOUT TIME ZONE,

  is_all_day BOOLEAN NOT NULL DEFAULT false,
  is_published BOOLEAN NOT NULL DEFAULT false,

  color TEXT,

  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_school_events_school ON school_events(school_id);
CREATE INDEX IF NOT EXISTS idx_school_events_class ON school_events(class_id);
CREATE INDEX IF NOT EXISTS idx_school_events_type ON school_events(event_type);
CREATE INDEX IF NOT EXISTS idx_school_events_audience ON school_events(audience);
CREATE INDEX IF NOT EXISTS idx_school_events_starts_at ON school_events(starts_at);
CREATE INDEX IF NOT EXISTS idx_school_events_published ON school_events(is_published);

COMMIT;
