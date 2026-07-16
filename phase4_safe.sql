BEGIN;

-- Track every answer
CREATE TABLE IF NOT EXISTS student_question_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id uuid REFERENCES questions(id) ON DELETE SET NULL,
  topic_id uuid REFERENCES topics(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,
  selected_option_id uuid REFERENCES question_options(id) ON DELETE SET NULL,
  is_correct boolean NOT NULL DEFAULT false,
  time_spent_sec int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Spaced repetition queue
CREATE TABLE IF NOT EXISTS student_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES topics(id),
  question_id uuid REFERENCES questions(id),
  reason text DEFAULT 'weak',
  priority int DEFAULT 5,
  due_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Recommendations engine
CREATE TABLE IF NOT EXISTS student_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES subjects(id),
  topic_id uuid REFERENCES topics(id),
  title text NOT NULL,
  reason text,
  priority int DEFAULT 5,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Indexes (safe)
CREATE INDEX IF NOT EXISTS idx_attempts_user ON student_question_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_review_due ON student_review_queue(user_id, due_at);
CREATE INDEX IF NOT EXISTS idx_reco_user ON student_recommendations(user_id);

COMMIT;
