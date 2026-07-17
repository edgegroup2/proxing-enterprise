BEGIN;

CREATE TABLE IF NOT EXISTS school_live_classroom_policies (
  school_id uuid PRIMARY KEY,

  provider text NOT NULL DEFAULT 'livekit',
  enabled boolean NOT NULL DEFAULT false,

  waiting_room_enabled boolean NOT NULL DEFAULT true,
  student_join_enabled boolean NOT NULL DEFAULT false,
  student_publish_policy text NOT NULL DEFAULT 'teacher_controlled',

  recording_enabled boolean NOT NULL DEFAULT false,

  max_participants integer NOT NULL DEFAULT 50,
  token_ttl_seconds integer NOT NULL DEFAULT 300,

  created_by_member_id uuid,
  updated_by_member_id uuid,

  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT school_live_classroom_policies_school_id_fkey
    FOREIGN KEY (school_id)
    REFERENCES schools(id)
    ON DELETE CASCADE,

  CONSTRAINT school_live_classroom_policies_created_by_member_id_fkey
    FOREIGN KEY (created_by_member_id)
    REFERENCES school_members(id)
    ON DELETE SET NULL,

  CONSTRAINT school_live_classroom_policies_updated_by_member_id_fkey
    FOREIGN KEY (updated_by_member_id)
    REFERENCES school_members(id)
    ON DELETE SET NULL,

  CONSTRAINT school_live_classroom_policies_provider_check
    CHECK (provider IN ('livekit')),

  CONSTRAINT school_live_classroom_student_publish_policy_check
    CHECK (
      student_publish_policy IN (
        'disabled',
        'teacher_controlled',
        'enabled'
      )
    ),

  CONSTRAINT school_live_classroom_max_participants_check
    CHECK (
      max_participants >= 2
      AND max_participants <= 500
    ),

  CONSTRAINT school_live_classroom_token_ttl_check
    CHECK (
      token_ttl_seconds >= 60
      AND token_ttl_seconds <= 900
    ),

  CONSTRAINT school_live_classroom_recording_disabled_initially_check
    CHECK (recording_enabled = false)
);

CREATE TABLE IF NOT EXISTS school_live_classroom_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL,
  lesson_session_id uuid NOT NULL,

  provider text NOT NULL DEFAULT 'livekit',
  room_name text NOT NULL,

  status text NOT NULL DEFAULT 'ready',

  host_member_id uuid,

  opened_at timestamp with time zone,
  closed_at timestamp with time zone,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT school_live_classroom_sessions_school_id_fkey
    FOREIGN KEY (school_id)
    REFERENCES schools(id)
    ON DELETE CASCADE,

  CONSTRAINT school_live_classroom_sessions_lesson_session_id_fkey
    FOREIGN KEY (lesson_session_id)
    REFERENCES school_lesson_sessions(id)
    ON DELETE CASCADE,

  CONSTRAINT school_live_classroom_sessions_host_member_id_fkey
    FOREIGN KEY (host_member_id)
    REFERENCES school_members(id)
    ON DELETE SET NULL,

  CONSTRAINT school_live_classroom_sessions_provider_check
    CHECK (provider IN ('livekit')),

  CONSTRAINT school_live_classroom_sessions_status_check
    CHECK (
      status IN (
        'ready',
        'open',
        'closed',
        'cancelled'
      )
    ),

  CONSTRAINT school_live_classroom_sessions_room_name_check
    CHECK (
      char_length(room_name) >= 10
      AND char_length(room_name) <= 255
    ),

  CONSTRAINT school_live_classroom_sessions_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object'),

  CONSTRAINT school_live_classroom_sessions_school_lesson_unique
    UNIQUE (school_id, lesson_session_id),

  CONSTRAINT school_live_classroom_sessions_provider_room_unique
    UNIQUE (provider, room_name)
);

CREATE INDEX IF NOT EXISTS
  school_live_classroom_sessions_school_status_idx
ON school_live_classroom_sessions (
  school_id,
  status,
  updated_at
);

CREATE INDEX IF NOT EXISTS
  school_live_classroom_sessions_lesson_idx
ON school_live_classroom_sessions (
  school_id,
  lesson_session_id
);

CREATE TABLE IF NOT EXISTS school_live_classroom_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL,
  live_classroom_session_id uuid NOT NULL,
  lesson_session_id uuid NOT NULL,

  event_type text NOT NULL,
  provider_event_id text,

  actor_member_id uuid,
  actor_user_id text,

  payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT school_live_classroom_events_school_id_fkey
    FOREIGN KEY (school_id)
    REFERENCES schools(id)
    ON DELETE CASCADE,

  CONSTRAINT school_live_classroom_events_session_id_fkey
    FOREIGN KEY (live_classroom_session_id)
    REFERENCES school_live_classroom_sessions(id)
    ON DELETE CASCADE,

  CONSTRAINT school_live_classroom_events_lesson_id_fkey
    FOREIGN KEY (lesson_session_id)
    REFERENCES school_lesson_sessions(id)
    ON DELETE CASCADE,

  CONSTRAINT school_live_classroom_events_actor_member_id_fkey
    FOREIGN KEY (actor_member_id)
    REFERENCES school_members(id)
    ON DELETE SET NULL,

  CONSTRAINT school_live_classroom_events_payload_check
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS
  school_live_classroom_events_provider_event_unique
ON school_live_classroom_events (
  provider_event_id
)
WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS
  school_live_classroom_events_session_created_idx
ON school_live_classroom_events (
  live_classroom_session_id,
  created_at
);

COMMIT;
