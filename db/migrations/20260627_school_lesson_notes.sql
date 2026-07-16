BEGIN;

CREATE TABLE IF NOT EXISTS school_lesson_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id UUID REFERENCES school_classes(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES school_subjects(id) ON DELETE SET NULL,
  teacher_member_id UUID REFERENCES school_members(id) ON DELETE SET NULL,

  title TEXT NOT NULL,
  topic TEXT,
  content TEXT,

  material_type TEXT NOT NULL DEFAULT 'note'
    CHECK (material_type IN ('note','pdf','video','audio','link','slide','document')),

  file_url TEXT,
  file_meta JSONB NOT NULL DEFAULT '{}'::jsonb,

  visibility TEXT NOT NULL DEFAULT 'class'
    CHECK (visibility IN ('class','school','teachers')),

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),

  published_at TIMESTAMP WITHOUT TIME ZONE,

  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_school_lesson_notes_school
ON school_lesson_notes(school_id);

CREATE INDEX IF NOT EXISTS idx_school_lesson_notes_class
ON school_lesson_notes(class_id);

CREATE INDEX IF NOT EXISTS idx_school_lesson_notes_subject
ON school_lesson_notes(subject_id);

CREATE INDEX IF NOT EXISTS idx_school_lesson_notes_teacher
ON school_lesson_notes(teacher_member_id);

CREATE INDEX IF NOT EXISTS idx_school_lesson_notes_status
ON school_lesson_notes(status);

COMMIT;
