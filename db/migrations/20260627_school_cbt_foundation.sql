BEGIN;

-- =========================================================
-- ENHANCE EXISTING SCHOOL EXAMS FOR CBT
-- =========================================================

ALTER TABLE school_exams
  ADD COLUMN IF NOT EXISTS shuffle_questions boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS shuffle_options boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_submit boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_result_immediately boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_answer_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS negative_marking_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pass_mark numeric(5,2) NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS question_count integer,
  ADD COLUMN IF NOT EXISTS late_entry_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS result_release_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS result_release_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS access_code_hash text,
  ADD COLUMN IF NOT EXISTS fullscreen_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS camera_required boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'school_exams_pass_mark_check'
  ) THEN
    ALTER TABLE school_exams
      ADD CONSTRAINT school_exams_pass_mark_check
      CHECK (pass_mark >= 0 AND pass_mark <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'school_exams_max_attempts_check'
  ) THEN
    ALTER TABLE school_exams
      ADD CONSTRAINT school_exams_max_attempts_check
      CHECK (max_attempts > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'school_exams_question_count_check'
  ) THEN
    ALTER TABLE school_exams
      ADD CONSTRAINT school_exams_question_count_check
      CHECK (question_count IS NULL OR question_count > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'school_exams_late_entry_check'
  ) THEN
    ALTER TABLE school_exams
      ADD CONSTRAINT school_exams_late_entry_check
      CHECK (late_entry_minutes >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'school_exams_release_mode_check'
  ) THEN
    ALTER TABLE school_exams
      ADD CONSTRAINT school_exams_release_mode_check
      CHECK (
        result_release_mode IN (
          'immediate',
          'scheduled',
          'manual'
        )
      );
  END IF;
END
$$;

-- =========================================================
-- REUSABLE SCHOOL QUESTION BANK
-- =========================================================

CREATE TABLE IF NOT EXISTS school_question_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL
    REFERENCES schools(id)
    ON DELETE CASCADE,

  subject_id uuid NOT NULL
    REFERENCES school_subjects(id)
    ON DELETE CASCADE,

  class_id uuid
    REFERENCES school_classes(id)
    ON DELETE SET NULL,

  created_by_member_id uuid
    REFERENCES school_members(id)
    ON DELETE SET NULL,

  topic text,
  subtopic text,

  curriculum text,
  syllabus_reference text,

  question_type text NOT NULL DEFAULT 'single_choice',
  question_text text NOT NULL,

  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer_key jsonb,

  explanation text,

  difficulty text NOT NULL DEFAULT 'medium',

  default_marks numeric(10,2) NOT NULL DEFAULT 1,
  default_negative_marks numeric(10,2) NOT NULL DEFAULT 0,

  media jsonb NOT NULL DEFAULT '{}'::jsonb,

  source text,
  language_code text NOT NULL DEFAULT 'en',

  status text NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,

  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  deleted_at timestamp without time zone,

  CONSTRAINT school_question_bank_type_check
    CHECK (
      question_type IN (
        'single_choice',
        'multiple_choice',
        'true_false',
        'short_answer',
        'essay'
      )
    ),

  CONSTRAINT school_question_bank_difficulty_check
    CHECK (
      difficulty IN (
        'easy',
        'medium',
        'hard',
        'advanced'
      )
    ),

  CONSTRAINT school_question_bank_status_check
    CHECK (
      status IN (
        'draft',
        'active',
        'archived'
      )
    ),

  CONSTRAINT school_question_bank_marks_check
    CHECK (default_marks > 0),

  CONSTRAINT school_question_bank_negative_marks_check
    CHECK (default_negative_marks >= 0),

  CONSTRAINT school_question_bank_version_check
    CHECK (version > 0),

  CONSTRAINT school_question_bank_options_array_check
    CHECK (jsonb_typeof(options) = 'array'),

  CONSTRAINT school_question_bank_answer_required_check
    CHECK (
      question_type = 'essay'
      OR answer_key IS NOT NULL
    )
);

-- =========================================================
-- QUESTIONS ATTACHED TO AN EXAM
-- =========================================================

CREATE TABLE IF NOT EXISTS school_exam_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL
    REFERENCES schools(id)
    ON DELETE CASCADE,

  exam_id uuid NOT NULL
    REFERENCES school_exams(id)
    ON DELETE CASCADE,

  question_id uuid NOT NULL
    REFERENCES school_question_bank(id)
    ON DELETE CASCADE,

  position integer NOT NULL,

  marks numeric(10,2) NOT NULL DEFAULT 1,
  negative_marks numeric(10,2) NOT NULL DEFAULT 0,

  is_required boolean NOT NULL DEFAULT true,

  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),

  CONSTRAINT school_exam_questions_unique
    UNIQUE (exam_id, question_id),

  CONSTRAINT school_exam_questions_position_check
    CHECK (position > 0),

  CONSTRAINT school_exam_questions_marks_check
    CHECK (marks > 0),

  CONSTRAINT school_exam_questions_negative_marks_check
    CHECK (negative_marks >= 0)
);

CREATE INDEX IF NOT EXISTS idx_school_question_bank_school
  ON school_question_bank(school_id);

CREATE INDEX IF NOT EXISTS idx_school_question_bank_subject
  ON school_question_bank(subject_id);

CREATE INDEX IF NOT EXISTS idx_school_question_bank_class
  ON school_question_bank(class_id);

CREATE INDEX IF NOT EXISTS idx_school_question_bank_topic
  ON school_question_bank(topic);

CREATE INDEX IF NOT EXISTS idx_school_question_bank_type
  ON school_question_bank(question_type);

CREATE INDEX IF NOT EXISTS idx_school_question_bank_difficulty
  ON school_question_bank(difficulty);

CREATE INDEX IF NOT EXISTS idx_school_question_bank_status
  ON school_question_bank(status);

CREATE INDEX IF NOT EXISTS idx_school_question_bank_search
  ON school_question_bank
  USING gin (
    to_tsvector(
      'simple',
      coalesce(question_text, '') || ' ' ||
      coalesce(topic, '') || ' ' ||
      coalesce(subtopic, '')
    )
  );

CREATE INDEX IF NOT EXISTS idx_school_exam_questions_school
  ON school_exam_questions(school_id);

CREATE INDEX IF NOT EXISTS idx_school_exam_questions_exam
  ON school_exam_questions(exam_id);

CREATE INDEX IF NOT EXISTS idx_school_exam_questions_question
  ON school_exam_questions(question_id);

CREATE INDEX IF NOT EXISTS idx_school_exam_questions_position
  ON school_exam_questions(exam_id, position);

COMMIT;
