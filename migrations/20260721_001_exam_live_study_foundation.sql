BEGIN;

CREATE TABLE IF NOT EXISTS exam_live_study_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  study_room_id uuid NOT NULL,

  provider text NOT NULL DEFAULT 'livekit',
  provider_room_name text NOT NULL,

  title text NOT NULL,
  description text,

  status text NOT NULL DEFAULT 'scheduled',

  waiting_room_enabled boolean NOT NULL DEFAULT false,
  member_publish_policy text NOT NULL DEFAULT 'host_only',

  max_participants integer NOT NULL DEFAULT 50,

  scheduled_start timestamp with time zone,
  scheduled_end timestamp with time zone,

  opened_at timestamp with time zone,
  closed_at timestamp with time zone,
  cancelled_at timestamp with time zone,

  created_by_user_id uuid NOT NULL,
  ended_by_user_id uuid,
  cancelled_by_user_id uuid,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT exam_live_study_sessions_room_id_fkey
    FOREIGN KEY (study_room_id)
    REFERENCES study_rooms(id)
    ON DELETE CASCADE,

  CONSTRAINT exam_live_study_sessions_created_by_user_id_fkey
    FOREIGN KEY (created_by_user_id)
    REFERENCES users(id)
    ON DELETE RESTRICT,

  CONSTRAINT exam_live_study_sessions_ended_by_user_id_fkey
    FOREIGN KEY (ended_by_user_id)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CONSTRAINT exam_live_study_sessions_cancelled_by_user_id_fkey
    FOREIGN KEY (cancelled_by_user_id)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CONSTRAINT exam_live_study_sessions_provider_check
    CHECK (provider IN ('livekit')),

  CONSTRAINT exam_live_study_sessions_status_check
    CHECK (
      status IN (
        'scheduled',
        'open',
        'closed',
        'cancelled'
      )
    ),

  CONSTRAINT exam_live_study_sessions_room_name_check
    CHECK (
      char_length(provider_room_name) >= 10
      AND char_length(provider_room_name) <= 255
    ),

  CONSTRAINT exam_live_study_sessions_title_check
    CHECK (
      char_length(title) >= 1
      AND char_length(title) <= 160
    ),

  CONSTRAINT exam_live_study_sessions_description_check
    CHECK (
      description IS NULL
      OR char_length(description) <= 2000
    ),

  CONSTRAINT exam_live_study_sessions_waiting_room_disabled_check
    CHECK (waiting_room_enabled = false),

  CONSTRAINT exam_live_study_sessions_publish_policy_check
    CHECK (
      member_publish_policy IN (
        'host_only'
      )
    ),

  CONSTRAINT exam_live_study_sessions_max_participants_check
    CHECK (
      max_participants >= 2
      AND max_participants <= 500
    ),

  CONSTRAINT exam_live_study_sessions_schedule_check
    CHECK (
      scheduled_end IS NULL
      OR scheduled_start IS NULL
      OR scheduled_end > scheduled_start
    ),

  CONSTRAINT exam_live_study_sessions_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object'),

  CONSTRAINT exam_live_study_sessions_state_check
    CHECK (
      (
        status = 'scheduled'
        AND opened_at IS NULL
        AND closed_at IS NULL
        AND cancelled_at IS NULL
      )
      OR
      (
        status = 'open'
        AND opened_at IS NOT NULL
        AND closed_at IS NULL
        AND cancelled_at IS NULL
      )
      OR
      (
        status = 'closed'
        AND opened_at IS NOT NULL
        AND closed_at IS NOT NULL
        AND cancelled_at IS NULL
      )
      OR
      (
        status = 'cancelled'
        AND opened_at IS NULL
        AND closed_at IS NULL
        AND cancelled_at IS NOT NULL
      )
    ),

  CONSTRAINT exam_live_study_sessions_provider_room_unique
    UNIQUE (
      provider,
      provider_room_name
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS
  exam_live_study_sessions_one_active_per_room
ON exam_live_study_sessions (
  study_room_id
)
WHERE status IN (
  'scheduled',
  'open'
);

CREATE INDEX IF NOT EXISTS
  exam_live_study_sessions_room_status_updated_idx
ON exam_live_study_sessions (
  study_room_id,
  status,
  updated_at DESC
);

CREATE INDEX IF NOT EXISTS
  exam_live_study_sessions_room_created_idx
ON exam_live_study_sessions (
  study_room_id,
  created_at DESC
);

CREATE TABLE IF NOT EXISTS exam_live_study_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  live_study_session_id uuid NOT NULL,
  user_id uuid NOT NULL,

  membership_role text NOT NULL,
  provider_identity text NOT NULL,

  presence_status text NOT NULL DEFAULT 'token_issued',

  token_issued_at timestamp with time zone NOT NULL DEFAULT now(),
  token_expires_at timestamp with time zone NOT NULL,

  first_connected_at timestamp with time zone,
  last_connected_at timestamp with time zone,
  last_seen_at timestamp with time zone,
  disconnected_at timestamp with time zone,

  connection_count integer NOT NULL DEFAULT 0,

  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT exam_live_study_participants_session_id_fkey
    FOREIGN KEY (live_study_session_id)
    REFERENCES exam_live_study_sessions(id)
    ON DELETE CASCADE,

  CONSTRAINT exam_live_study_participants_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  CONSTRAINT exam_live_study_participants_membership_role_check
    CHECK (
      membership_role IN (
        'host',
        'member'
      )
    ),

  CONSTRAINT exam_live_study_participants_presence_status_check
    CHECK (
      presence_status IN (
        'token_issued',
        'connected',
        'disconnected'
      )
    ),

  CONSTRAINT exam_live_study_participants_identity_check
    CHECK (
      char_length(provider_identity) >= 10
      AND char_length(provider_identity) <= 255
    ),

  CONSTRAINT exam_live_study_participants_expiry_check
    CHECK (token_expires_at > token_issued_at),

  CONSTRAINT exam_live_study_participants_connection_count_check
    CHECK (connection_count >= 0),

  CONSTRAINT exam_live_study_participants_session_user_unique
    UNIQUE (
      live_study_session_id,
      user_id
    ),

  CONSTRAINT exam_live_study_participants_session_identity_unique
    UNIQUE (
      live_study_session_id,
      provider_identity
    )
);

CREATE INDEX IF NOT EXISTS
  exam_live_study_participants_session_presence_idx
ON exam_live_study_participants (
  live_study_session_id,
  presence_status,
  token_expires_at
);

CREATE INDEX IF NOT EXISTS
  exam_live_study_participants_session_seen_idx
ON exam_live_study_participants (
  live_study_session_id,
  last_seen_at DESC
);

CREATE INDEX IF NOT EXISTS
  exam_live_study_participants_user_session_idx
ON exam_live_study_participants (
  user_id,
  live_study_session_id
);

CREATE TABLE IF NOT EXISTS exam_live_study_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  live_study_session_id uuid NOT NULL,

  event_type text NOT NULL,
  actor_user_id uuid,
  provider_event_id text,

  payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT exam_live_study_events_session_id_fkey
    FOREIGN KEY (live_study_session_id)
    REFERENCES exam_live_study_sessions(id)
    ON DELETE CASCADE,

  CONSTRAINT exam_live_study_events_actor_user_id_fkey
    FOREIGN KEY (actor_user_id)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CONSTRAINT exam_live_study_events_type_check
    CHECK (
      event_type IN (
        'session_created',
        'session_started',
        'join_token_issued',
        'participant_connected',
        'participant_heartbeat',
        'participant_disconnected',
        'session_ended',
        'session_cancelled'
      )
    ),

  CONSTRAINT exam_live_study_events_payload_check
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS
  exam_live_study_events_provider_event_unique
ON exam_live_study_events (
  provider_event_id
)
WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS
  exam_live_study_events_session_created_idx
ON exam_live_study_events (
  live_study_session_id,
  created_at DESC
);

COMMIT;
