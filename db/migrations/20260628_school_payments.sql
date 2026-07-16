BEGIN;

CREATE TABLE IF NOT EXISTS school_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES school_invoices(id) ON DELETE SET NULL,

  amount NUMERIC(12,2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash','bank_transfer','card','pos','mobile_money','online','cheque','other')),

  reference TEXT,
  notes TEXT,

  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('pending','confirmed','failed','reversed')),

  paid_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  received_by_member_id UUID REFERENCES school_members(id) ON DELETE SET NULL,

  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITHOUT TIME ZONE,

  CHECK (amount > 0)
);

CREATE TABLE IF NOT EXISTS school_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES school_payments(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES school_invoices(id) ON DELETE CASCADE,

  amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),

  CHECK (amount > 0),
  UNIQUE (payment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_school_payments_school
ON school_payments(school_id);

CREATE INDEX IF NOT EXISTS idx_school_payments_student
ON school_payments(student_id);

CREATE INDEX IF NOT EXISTS idx_school_payments_invoice
ON school_payments(invoice_id);

CREATE INDEX IF NOT EXISTS idx_school_payments_status
ON school_payments(status);

CREATE INDEX IF NOT EXISTS idx_school_payments_paid_at
ON school_payments(paid_at);

CREATE INDEX IF NOT EXISTS idx_school_payment_allocations_invoice
ON school_payment_allocations(invoice_id);

CREATE INDEX IF NOT EXISTS idx_school_payment_allocations_payment
ON school_payment_allocations(payment_id);

COMMIT;
