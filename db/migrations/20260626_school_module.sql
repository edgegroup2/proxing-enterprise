BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  school_type text NOT NULL,
  state text NOT NULL,
  lga text,
  city text,
  address text,
  official_phone text,
  official_email text,
  verification_status text NOT NULL DEFAULT 'submitted',
  verified_at timestamptz,
  verified_by uuid REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,

  CONSTRAINT schools_verification_status_check CHECK (
    verification_status IN (
      'draft',
      'submitted',
      'under_review',
      'verified',
      'requires_information',
      'declined'
    )
  )
);

CREATE TABLE IF NOT EXISTS school_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  full_name text,
  email text,
  phone text,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  invited_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT school_members_role_check CHECK (
    role IN ('principal', 'admin', 'teacher', 'student', 'guardian')
  ),

  CONSTRAINT school_members_status_check CHECK (
    status IN ('invited', 'active', 'suspended', 'removed')
  )
);

CREATE TABLE IF NOT EXISTS school_exam_focus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  exam_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT school_exam_focus_exam_type_check CHECK (
    exam_type IN ('JAMB', 'WAEC', 'NECO', 'POST_UTME', 'IELTS', 'SAT', 'GRE', 'TOEFL')
  ),

  UNIQUE (school_id, exam_type)
);

CREATE TABLE IF NOT EXISTS school_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
  estimated_students integer NOT NULL DEFAULT 0,
  estimated_teachers integer,
  ss3_students integer,
  jamb_candidates integer,
  expected_launch_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT school_estimates_students_check CHECK (estimated_students >= 0),
  CONSTRAINT school_estimates_teachers_check CHECK (estimated_teachers IS NULL OR estimated_teachers >= 0),
  CONSTRAINT school_estimates_ss3_check CHECK (ss3_students IS NULL OR ss3_students >= 0),
  CONSTRAINT school_estimates_jamb_check CHECK (jamb_candidates IS NULL OR jamb_candidates >= 0)
);

CREATE TABLE IF NOT EXISTS school_partnership_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
  individual_student_subscriptions boolean NOT NULL DEFAULT true,
  school_sponsored_seats boolean NOT NULL DEFAULT false,
  interested_in_pilot boolean NOT NULL DEFAULT false,
  interested_in_demo boolean NOT NULL DEFAULT false,
  referral_source text,
  referral_source_other text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS school_verification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  from_status text,
  to_status text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS school_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL,
  entry_type text NOT NULL,
  source text NOT NULL,
  description text,
  reference text,
  period_month date,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT school_credit_ledger_amount_check CHECK (amount <> 0),

  CONSTRAINT school_credit_ledger_entry_type_check CHECK (
    entry_type IN ('credit', 'debit', 'adjustment')
  ),

  CONSTRAINT school_credit_ledger_source_check CHECK (
    source IN (
      'premium_student',
      'manual_adjustment',
      'redemption',
      'bonus',
      'reversal'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_schools_status ON schools(verification_status);
CREATE INDEX IF NOT EXISTS idx_schools_state_lga ON schools(state, lga);
CREATE INDEX IF NOT EXISTS idx_schools_created_at ON schools(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_school_members_school_id ON school_members(school_id);
CREATE INDEX IF NOT EXISTS idx_school_members_user_id ON school_members(user_id);
CREATE INDEX IF NOT EXISTS idx_school_members_role ON school_members(role);
CREATE INDEX IF NOT EXISTS idx_school_exam_focus_school_id ON school_exam_focus(school_id);
CREATE INDEX IF NOT EXISTS idx_school_credit_ledger_school_id ON school_credit_ledger(school_id);
CREATE INDEX IF NOT EXISTS idx_school_credit_ledger_student_user_id ON school_credit_ledger(student_user_id);
CREATE INDEX IF NOT EXISTS idx_school_credit_ledger_period ON school_credit_ledger(period_month);
CREATE INDEX IF NOT EXISTS idx_school_verification_logs_school_id ON school_verification_logs(school_id);

COMMIT;
