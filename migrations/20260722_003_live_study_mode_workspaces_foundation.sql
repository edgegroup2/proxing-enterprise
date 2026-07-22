BEGIN;

CREATE TABLE IF NOT EXISTS exam_live_study_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_study_session_id uuid NOT NULL,
  workspace_mode text NOT NULL,
  status text NOT NULL DEFAULT 'idle',
  version integer NOT NULL DEFAULT 1,
  last_event_sequence bigint NOT NULL DEFAULT 0,
  created_by_user_id uuid NOT NULL,
  activated_at timestamp with time zone,
  completed_at timestamp with time zone,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT exam_live_study_workspaces_session_fkey
    FOREIGN KEY (live_study_session_id)
    REFERENCES exam_live_study_sessions(id)
    ON DELETE CASCADE,

  CONSTRAINT exam_live_study_workspaces_creator_fkey
    FOREIGN KEY (created_by_user_id)
    REFERENCES users(id)
    ON DELETE RESTRICT,

  CONSTRAINT exam_live_study_workspaces_session_unique
    UNIQUE (live_study_session_id),

  CONSTRAINT exam_live_study_workspaces_mode_check
    CHECK (
      workspace_mode IN (
        'revision',
        'challenge',
        'tutor_led'
      )
    ),

  CONSTRAINT exam_live_study_workspaces_status_check
    CHECK (
      status IN (
        'idle',
        'active',
        'completed'
      )
    ),

  CONSTRAINT exam_live_study_workspaces_version_check
    CHECK (version >= 1),

  CONSTRAINT exam_live_study_workspaces_sequence_check
    CHECK (last_event_sequence >= 0),

  CONSTRAINT exam_live_study_workspaces_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object'),

  CONSTRAINT exam_live_study_workspaces_state_check
    CHECK (
      (
        status = 'idle'
        AND activated_at IS NULL
        AND completed_at IS NULL
      )
      OR
      (
        status = 'active'
        AND activated_at IS NOT NULL
        AND completed_at IS NULL
      )
      OR
      (
        status = 'completed'
        AND activated_at IS NOT NULL
        AND completed_at IS NOT NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS
  exam_live_study_workspaces_mode_status_idx
ON exam_live_study_workspaces (
  workspace_mode,
  status,
  updated_at DESC
);

CREATE TABLE IF NOT EXISTS exam_live_study_workspace_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  sequence_number bigint NOT NULL,
  event_type text NOT NULL,
  actor_user_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT exam_live_study_workspace_events_workspace_fkey
    FOREIGN KEY (workspace_id)
    REFERENCES exam_live_study_workspaces(id)
    ON DELETE CASCADE,

  CONSTRAINT exam_live_study_workspace_events_actor_fkey
    FOREIGN KEY (actor_user_id)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CONSTRAINT exam_live_study_workspace_events_sequence_check
    CHECK (sequence_number >= 1),

  CONSTRAINT exam_live_study_workspace_events_type_check
    CHECK (
      event_type IN (
        'workspace_created',
        'workspace_started',
        'workspace_completed',
        'revision_activity_created',
        'revision_activity_started',
        'revision_submission_received',
        'revision_activity_revealed',
        'revision_activity_completed',
        'revision_note_created',
        'revision_note_updated',
        'revision_note_deleted'
      )
    ),

  CONSTRAINT exam_live_study_workspace_events_payload_check
    CHECK (jsonb_typeof(payload) = 'object'),

  CONSTRAINT exam_live_study_workspace_events_sequence_unique
    UNIQUE (
      workspace_id,
      sequence_number
    )
);

CREATE INDEX IF NOT EXISTS
  exam_live_study_workspace_events_created_idx
ON exam_live_study_workspace_events (
  workspace_id,
  created_at,
  id
);

CREATE TABLE IF NOT EXISTS exam_live_study_revision_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  position integer NOT NULL,
  question_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  time_limit_seconds integer,
  question_snapshot jsonb NOT NULL,
  answer_key_snapshot jsonb NOT NULL,
  explanation_snapshot text,
  created_by_user_id uuid NOT NULL,
  started_at timestamp with time zone,
  revealed_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT exam_live_study_revision_activities_workspace_fkey
    FOREIGN KEY (workspace_id)
    REFERENCES exam_live_study_workspaces(id)
    ON DELETE CASCADE,

  CONSTRAINT exam_live_study_revision_activities_creator_fkey
    FOREIGN KEY (created_by_user_id)
    REFERENCES users(id)
    ON DELETE RESTRICT,

  CONSTRAINT exam_live_study_revision_activities_position_check
    CHECK (position >= 1),

  CONSTRAINT exam_live_study_revision_activities_state_check
    CHECK (
      state IN (
        'draft',
        'active',
        'revealed',
        'completed'
      )
    ),

  CONSTRAINT exam_live_study_revision_activities_time_limit_check
    CHECK (
      time_limit_seconds IS NULL
      OR (
        time_limit_seconds >= 10
        AND time_limit_seconds <= 3600
      )
    ),

  CONSTRAINT exam_live_study_revision_question_snapshot_check
    CHECK (
      jsonb_typeof(question_snapshot) = 'object'
    ),

  CONSTRAINT exam_live_study_revision_answer_snapshot_check
    CHECK (
      jsonb_typeof(answer_key_snapshot) IS NOT NULL
      AND jsonb_typeof(answer_key_snapshot) <> 'null'
    ),

  CONSTRAINT exam_live_study_revision_explanation_check
    CHECK (
      explanation_snapshot IS NULL
      OR char_length(explanation_snapshot) <= 10000
    ),

  CONSTRAINT exam_live_study_revision_activity_state_check
    CHECK (
      (
        state = 'draft'
        AND started_at IS NULL
        AND revealed_at IS NULL
        AND completed_at IS NULL
      )
      OR
      (
        state = 'active'
        AND started_at IS NOT NULL
        AND revealed_at IS NULL
        AND completed_at IS NULL
      )
      OR
      (
        state = 'revealed'
        AND started_at IS NOT NULL
        AND revealed_at IS NOT NULL
        AND completed_at IS NULL
      )
      OR
      (
        state = 'completed'
        AND started_at IS NOT NULL
        AND revealed_at IS NOT NULL
        AND completed_at IS NOT NULL
      )
    ),

  CONSTRAINT exam_live_study_revision_position_unique
    UNIQUE (
      workspace_id,
      position
    ),

  CONSTRAINT exam_live_study_revision_id_workspace_unique
    UNIQUE (
      id,
      workspace_id
    )
);

CREATE INDEX IF NOT EXISTS
  exam_live_study_revision_activities_state_idx
ON exam_live_study_revision_activities (
  workspace_id,
  state,
  position
);

CREATE TABLE IF NOT EXISTS exam_live_study_revision_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  answer jsonb NOT NULL,
  is_correct boolean,
  response_time_ms integer,
  submitted_at timestamp with time zone NOT NULL DEFAULT now(),
  evaluated_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT exam_live_study_revision_submissions_activity_fkey
    FOREIGN KEY (
      activity_id,
      workspace_id
    )
    REFERENCES exam_live_study_revision_activities (
      id,
      workspace_id
    )
    ON DELETE CASCADE,

  CONSTRAINT exam_live_study_revision_submissions_user_fkey
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  CONSTRAINT exam_live_study_revision_submission_answer_check
    CHECK (
      jsonb_typeof(answer) IS NOT NULL
      AND jsonb_typeof(answer) <> 'null'
    ),

  CONSTRAINT exam_live_study_revision_response_time_check
    CHECK (
      response_time_ms IS NULL
      OR response_time_ms >= 0
    ),

  CONSTRAINT exam_live_study_revision_evaluation_check
    CHECK (
      (
        is_correct IS NULL
        AND evaluated_at IS NULL
      )
      OR
      (
        is_correct IS NOT NULL
        AND evaluated_at IS NOT NULL
      )
    ),

  CONSTRAINT exam_live_study_revision_submission_unique
    UNIQUE (
      activity_id,
      user_id
    )
);

CREATE INDEX IF NOT EXISTS
  exam_live_study_revision_submissions_activity_idx
ON exam_live_study_revision_submissions (
  activity_id,
  submitted_at,
  id
);

CREATE INDEX IF NOT EXISTS
  exam_live_study_revision_submissions_user_idx
ON exam_live_study_revision_submissions (
  user_id,
  submitted_at DESC
);

CREATE TABLE IF NOT EXISTS exam_live_study_revision_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  body text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,

  CONSTRAINT exam_live_study_revision_notes_workspace_fkey
    FOREIGN KEY (workspace_id)
    REFERENCES exam_live_study_workspaces(id)
    ON DELETE CASCADE,

  CONSTRAINT exam_live_study_revision_notes_author_fkey
    FOREIGN KEY (author_user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  CONSTRAINT exam_live_study_revision_notes_body_check
    CHECK (
      char_length(body) >= 1
      AND char_length(body) <= 4000
    ),

  CONSTRAINT exam_live_study_revision_notes_version_check
    CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS
  exam_live_study_revision_notes_active_idx
ON exam_live_study_revision_notes (
  workspace_id,
  created_at,
  id
)
WHERE deleted_at IS NULL;

COMMIT;
