BEGIN;

CREATE TABLE IF NOT EXISTS school_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  created_by_member_id UUID REFERENCES school_members(id) ON DELETE SET NULL,
  class_id UUID REFERENCES school_classes(id) ON DELETE SET NULL,

  title TEXT NOT NULL,
  body TEXT NOT NULL,

  audience TEXT NOT NULL DEFAULT 'school'
    CHECK (audience IN ('school','class','teachers','students','parents')),

  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),

  pinned BOOLEAN NOT NULL DEFAULT false,
  published BOOLEAN NOT NULL DEFAULT false,

  attachment_url TEXT,
  attachment_meta JSONB NOT NULL DEFAULT '{}'::jsonb,

  publish_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITHOUT TIME ZONE,

  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_school_announcements_school
ON school_announcements(school_id);

CREATE INDEX IF NOT EXISTS idx_school_announcements_class
ON school_announcements(class_id);

CREATE INDEX IF NOT EXISTS idx_school_announcements_audience
ON school_announcements(audience);

CREATE INDEX IF NOT EXISTS idx_school_announcements_published
ON school_announcements(published);

COMMIT;
