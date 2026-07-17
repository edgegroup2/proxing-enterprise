BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS
  school_lesson_sessions_school_id_id_unique
ON school_lesson_sessions (
  school_id,
  id
);

CREATE UNIQUE INDEX IF NOT EXISTS
  school_students_school_id_id_unique
ON school_students (
  school_id,
  id
);

CREATE TABLE IF NOT EXISTS
  school_live_classroom_admissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    school_id uuid NOT NULL,
    lesson_session_id uuid NOT NULL,

    student_id uuid NOT NULL,
    member_id uuid NOT NULL,

    status text NOT NULL DEFAULT 'pending',

    requested_at timestamp with time zone
      NOT NULL DEFAULT now(),

    admitted_at timestamp with time zone,
    rejected_at timestamp with time zone,

    decided_by_member_id uuid,
    decision_note text,

    created_at timestamp with time zone
      NOT NULL DEFAULT now(),

    updated_at timestamp with time zone
      NOT NULL DEFAULT now(),

    CONSTRAINT
      school_live_classroom_admissions_school_id_fkey
      FOREIGN KEY (school_id)
      REFERENCES schools(id)
      ON DELETE CASCADE,

    CONSTRAINT
      school_live_classroom_admissions_lesson_fkey
      FOREIGN KEY (
        school_id,
        lesson_session_id
      )
      REFERENCES school_lesson_sessions (
        school_id,
        id
      )
      ON DELETE CASCADE,

    CONSTRAINT
      school_live_classroom_admissions_student_fkey
      FOREIGN KEY (
        school_id,
        student_id
      )
      REFERENCES school_students (
        school_id,
        id
      )
      ON DELETE CASCADE,

    CONSTRAINT
      school_live_classroom_admissions_member_fkey
      FOREIGN KEY (
        school_id,
        member_id
      )
      REFERENCES school_members (
        school_id,
        id
      ),

    CONSTRAINT
      school_live_classroom_admissions_decider_fkey
      FOREIGN KEY (
        school_id,
        decided_by_member_id
      )
      REFERENCES school_members (
        school_id,
        id
      ),

    CONSTRAINT
      school_live_classroom_admissions_status_check
      CHECK (
        status IN (
          'pending',
          'admitted',
          'rejected'
        )
      ),

    CONSTRAINT
      school_live_classroom_admissions_state_check
      CHECK (
        (
          status = 'pending'
          AND admitted_at IS NULL
          AND rejected_at IS NULL
          AND decided_by_member_id IS NULL
        )
        OR
        (
          status = 'admitted'
          AND admitted_at IS NOT NULL
          AND rejected_at IS NULL
          AND decided_by_member_id IS NOT NULL
        )
        OR
        (
          status = 'rejected'
          AND rejected_at IS NOT NULL
          AND admitted_at IS NULL
          AND decided_by_member_id IS NOT NULL
        )
      ),

    CONSTRAINT
      school_live_classroom_admissions_note_check
      CHECK (
        decision_note IS NULL
        OR char_length(decision_note) <= 1000
      ),

    CONSTRAINT
      school_live_classroom_admissions_student_unique
      UNIQUE (
        school_id,
        lesson_session_id,
        student_id
      ),

    CONSTRAINT
      school_live_classroom_admissions_member_unique
      UNIQUE (
        school_id,
        lesson_session_id,
        member_id
      ),

    CONSTRAINT
      school_live_classroom_admissions_school_id_id_unique
      UNIQUE (
        school_id,
        id
      )
  );

CREATE INDEX IF NOT EXISTS
  school_live_classroom_admissions_lesson_status_idx
ON school_live_classroom_admissions (
  school_id,
  lesson_session_id,
  status,
  requested_at
);

CREATE INDEX IF NOT EXISTS
  school_live_classroom_admissions_member_idx
ON school_live_classroom_admissions (
  school_id,
  member_id,
  lesson_session_id
);

CREATE TABLE IF NOT EXISTS
  school_live_classroom_admission_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    school_id uuid NOT NULL,
    admission_id uuid NOT NULL,
    lesson_session_id uuid NOT NULL,

    event_type text NOT NULL,

    actor_member_id uuid,
    actor_user_id text,

    payload jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at timestamp with time zone
      NOT NULL DEFAULT now(),

    CONSTRAINT
      school_live_classroom_admission_events_school_id_fkey
      FOREIGN KEY (school_id)
      REFERENCES schools(id)
      ON DELETE CASCADE,

    CONSTRAINT
      school_live_classroom_admission_events_admission_fkey
      FOREIGN KEY (
        school_id,
        admission_id
      )
      REFERENCES school_live_classroom_admissions (
        school_id,
        id
      )
      ON DELETE CASCADE,

    CONSTRAINT
      school_live_classroom_admission_events_lesson_fkey
      FOREIGN KEY (
        school_id,
        lesson_session_id
      )
      REFERENCES school_lesson_sessions (
        school_id,
        id
      )
      ON DELETE CASCADE,

    CONSTRAINT
      school_live_classroom_admission_events_actor_fkey
      FOREIGN KEY (
        school_id,
        actor_member_id
      )
      REFERENCES school_members (
        school_id,
        id
      ),

    CONSTRAINT
      school_live_classroom_admission_events_type_check
      CHECK (
        event_type IN (
          'admission_requested',
          'admission_admitted',
          'admission_rejected'
        )
      ),

    CONSTRAINT
      school_live_classroom_admission_events_payload_check
      CHECK (
        jsonb_typeof(payload) = 'object'
      )
  );

CREATE INDEX IF NOT EXISTS
  school_live_classroom_admission_events_admission_created_idx
ON school_live_classroom_admission_events (
  admission_id,
  created_at
);

COMMIT;
