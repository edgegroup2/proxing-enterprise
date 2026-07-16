BEGIN;

CREATE TABLE IF NOT EXISTS school_application_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_school_application_events_school
ON school_application_events(school_id);

CREATE INDEX IF NOT EXISTS idx_school_application_events_created
ON school_application_events(created_at DESC);


CREATE OR REPLACE VIEW v_school_subscriptions AS
SELECT
    s.id AS school_id,
    s.name AS school_name,
    s.verification_status,
    0::numeric AS amount,
    'none'::text AS plan,
    NULL::timestamptz AS expires_at
FROM schools s;


CREATE TABLE IF NOT EXISTS school_support_credit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    credit_type TEXT NOT NULL,
    seats INTEGER DEFAULT 0,
    credits NUMERIC(12,2) DEFAULT 0,
    reason TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_school_support_credit_school
ON school_support_credit_ledger(school_id);


CREATE TABLE IF NOT EXISTS school_sponsored_seats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    sponsored_by UUID REFERENCES users(id),
    seats INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMIT;
