BEGIN;

CREATE TABLE IF NOT EXISTS school_lesson_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL,
  timetable_entry_id uuid,
  class_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  teacher_member_id uuid NOT NULL,

  lesson_date date NOT NULL,
  scheduled_start timestamp without time zone NOT NULL,
  scheduled_end timestamp without time zone NOT NULL,

  delivery_mode text NOT NULL DEFAULT 'physical',
  status text NOT NULL DEFAULT 'scheduled',

  topic text,
  objectives text,
  lesson_summary text,
  teacher_remark text,

  attendance_completed boolean NOT NULL DEFAULT false,

  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  cancellation_reason text,

  created_by_member_id uuid,
  started_by_member_id uuid,
  ended_by_member_id uuid,
  cancelled_by_member_id uuid,

  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT school_lesson_sessions_school_id_fkey
    FOREIGN KEY (school_id)
    REFERENCES schools(id)
    ON DELETE CASCADE,

  CONSTRAINT school_lesson_sessions_timetable_entry_id_fkey
    FOREIGN KEY (timetable_entry_id)
    REFERENCES school_timetables(id)
    ON DELETE SET NULL,

  CONSTRAINT school_lesson_sessions_class_id_fkey
    FOREIGN KEY (class_id)
    REFERENCES school_classes(id)
    ON DELETE RESTRICT,

  CONSTRAINT school_lesson_sessions_subject_id_fkey
    FOREIGN KEY (subject_id)
    REFERENCES school_subjects(id)
    ON DELETE RESTRICT,

  CONSTRAINT school_lesson_sessions_teacher_member_id_fkey
    FOREIGN KEY (teacher_member_id)
    REFERENCES school_members(id)
    ON DELETE RESTRICT,

  CONSTRAINT school_lesson_sessions_created_by_member_id_fkey
    FOREIGN KEY (created_by_member_id)
    REFERENCES school_members(id)
    ON DELETE SET NULL,

  CONSTRAINT school_lesson_sessions_started_by_member_id_fkey
    FOREIGN KEY (started_by_member_id)
    REFERENCES school_members(id)
    ON DELETE SET NULL,

  CONSTRAINT school_lesson_sessions_ended_by_member_id_fkey
    FOREIGN KEY (ended_by_member_id)
    REFERENCES school_members(id)
    ON DELETE SET NULL,

  CONSTRAINT school_lesson_sessions_cancelled_by_member_id_fkey
    FOREIGN KEY (cancelled_by_member_id)
    REFERENCES school_members(id)
    ON DELETE SET NULL,

  CONSTRAINT school_lesson_sessions_delivery_mode_check
    CHECK (
      delivery_mode IN (
        'physical',
        'online',
        'hybrid'
      )
    ),

  CONSTRAINT school_lesson_sessions_status_check
    CHECK (
      status IN (
        'scheduled',
        'in_progress',
        'completed',
        'cancelled',
        'missed'
      )
    ),

  CONSTRAINT school_lesson_sessions_schedule_check
    CHECK (scheduled_end > scheduled_start),

  CONSTRAINT school_lesson_sessions_progress_check
    CHECK (
      status <> 'in_progress'
      OR started_at IS NOT NULL
    ),

  CONSTRAINT school_lesson_sessions_completed_check
    CHECK (
      status <> 'completed'
      OR (
        started_at IS NOT NULL
        AND ended_at IS NOT NULL
      )
    ),

  CONSTRAINT school_lesson_sessions_cancelled_check
    CHECK (
      status <> 'cancelled'
      OR cancelled_at IS NOT NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS
  school_lesson_sessions_timetable_occurrence_unique
ON school_lesson_sessions (
  school_id,
  timetable_entry_id,
  lesson_date
)
WHERE timetable_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS
  school_lesson_sessions_school_date_idx
ON school_lesson_sessions (
  school_id,
  lesson_date
);

CREATE INDEX IF NOT EXISTS
  school_lesson_sessions_school_status_date_idx
ON school_lesson_sessions (
  school_id,
  status,
  lesson_date
);

CREATE INDEX IF NOT EXISTS
  school_lesson_sessions_teacher_date_idx
ON school_lesson_sessions (
  school_id,
  teacher_member_id,
  lesson_date
);

CREATE INDEX IF NOT EXISTS
  school_lesson_sessions_class_date_idx
ON school_lesson_sessions (
  school_id,
  class_id,
  lesson_date
);

CREATE INDEX IF NOT EXISTS
  school_lesson_sessions_timetable_idx
ON school_lesson_sessions (
  timetable_entry_id
)
WHERE timetable_entry_id IS NOT NULL;


CREATE TABLE IF NOT EXISTS school_lesson_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL,
  lesson_session_id uuid NOT NULL,

  artifact_type text NOT NULL,

  assignment_id uuid,
  exam_id uuid,
  lesson_note_id uuid,
  resource_id uuid,

  title text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_by_member_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT school_lesson_artifacts_school_id_fkey
    FOREIGN KEY (school_id)
    REFERENCES schools(id)
    ON DELETE CASCADE,

  CONSTRAINT school_lesson_artifacts_lesson_session_id_fkey
    FOREIGN KEY (lesson_session_id)
    REFERENCES school_lesson_sessions(id)
    ON DELETE CASCADE,

  CONSTRAINT school_lesson_artifacts_assignment_id_fkey
    FOREIGN KEY (assignment_id)
    REFERENCES school_assignments(id)
    ON DELETE CASCADE,

  CONSTRAINT school_lesson_artifacts_exam_id_fkey
    FOREIGN KEY (exam_id)
    REFERENCES school_exams(id)
    ON DELETE CASCADE,

  CONSTRAINT school_lesson_artifacts_lesson_note_id_fkey
    FOREIGN KEY (lesson_note_id)
    REFERENCES school_lesson_notes(id)
    ON DELETE CASCADE,

  CONSTRAINT school_lesson_artifacts_resource_id_fkey
    FOREIGN KEY (resource_id)
    REFERENCES school_resources(id)
    ON DELETE CASCADE,

  CONSTRAINT school_lesson_artifacts_created_by_member_id_fkey
    FOREIGN KEY (created_by_member_id)
    REFERENCES school_members(id)
    ON DELETE SET NULL,

  CONSTRAINT school_lesson_artifacts_type_check
    CHECK (
      artifact_type IN (
        'assignment',
        'school_cbt',
        'lesson_note',
        'resource'
      )
    ),

  CONSTRAINT school_lesson_artifacts_target_check
    CHECK (
      (
        artifact_type = 'assignment'
        AND assignment_id IS NOT NULL
        AND exam_id IS NULL
        AND lesson_note_id IS NULL
        AND resource_id IS NULL
      )
      OR
      (
        artifact_type = 'school_cbt'
        AND assignment_id IS NULL
        AND exam_id IS NOT NULL
        AND lesson_note_id IS NULL
        AND resource_id IS NULL
      )
      OR
      (
        artifact_type = 'lesson_note'
        AND assignment_id IS NULL
        AND exam_id IS NULL
        AND lesson_note_id IS NOT NULL
        AND resource_id IS NULL
      )
      OR
      (
        artifact_type = 'resource'
        AND assignment_id IS NULL
        AND exam_id IS NULL
        AND lesson_note_id IS NULL
        AND resource_id IS NOT NULL
      )
    ),

  CONSTRAINT school_lesson_artifacts_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS
  school_lesson_artifacts_lesson_idx
ON school_lesson_artifacts (
  school_id,
  lesson_session_id,
  created_at
);

CREATE UNIQUE INDEX IF NOT EXISTS
  school_lesson_artifacts_assignment_unique
ON school_lesson_artifacts (
  lesson_session_id,
  assignment_id
)
WHERE assignment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
  school_lesson_artifacts_exam_unique
ON school_lesson_artifacts (
  lesson_session_id,
  exam_id
)
WHERE exam_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
  school_lesson_artifacts_note_unique
ON school_lesson_artifacts (
  lesson_session_id,
  lesson_note_id
)
WHERE lesson_note_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
  school_lesson_artifacts_resource_unique
ON school_lesson_artifacts (
  lesson_session_id,
  resource_id
)
WHERE resource_id IS NOT NULL;

COMMIT;
