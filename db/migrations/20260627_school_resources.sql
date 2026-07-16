BEGIN;

CREATE TABLE IF NOT EXISTS school_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id UUID REFERENCES school_classes(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES school_subjects(id) ON DELETE SET NULL,
  teacher_member_id UUID REFERENCES school_members(id) ON DELETE SET NULL,

  title TEXT NOT NULL,
  description TEXT,

  resource_type TEXT NOT NULL DEFAULT 'document'
    CHECK (resource_type IN ('pdf','video','audio','image','link','slide','document','zip','other')),

  file_url TEXT,
  file_meta JSONB NOT NULL DEFAULT '{}'::jsonb,

  visibility TEXT NOT NULL DEFAULT 'class'
    CHECK (visibility IN ('class','school','teachers','students')),

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),

  published_at TIMESTAMP WITHOUT TIME ZONE,

  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_school_resources_school
ON school_resources(school_id);

CREATE INDEX IF NOT EXISTS idx_school_resources_class
ON school_resources(class_id);

CREATE INDEX IF NOT EXISTS idx_school_resources_subject
ON school_resources(subject_id);

CREATE INDEX IF NOT EXISTS idx_school_resources_teacher
ON school_resources(teacher_member_id);

CREATE INDEX IF NOT EXISTS idx_school_resources_status
ON school_resources(status);

CREATE INDEX IF NOT EXISTS idx_school_resources_type
ON school_resources(resource_type);

COMMIT;
