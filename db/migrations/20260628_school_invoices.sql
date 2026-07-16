BEGIN;

CREATE TABLE IF NOT EXISTS school_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  class_id UUID REFERENCES school_classes(id) ON DELETE SET NULL,

  invoice_no TEXT NOT NULL,
  academic_session TEXT NOT NULL,
  term TEXT NOT NULL,

  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_amount NUMERIC(12,2) NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (status IN ('unpaid','partial','paid','cancelled')),

  due_date DATE,
  notes TEXT,

  issued_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITHOUT TIME ZONE,

  UNIQUE (school_id, invoice_no),
  UNIQUE (school_id, student_id, academic_session, term)
);

CREATE TABLE IF NOT EXISTS school_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  invoice_id UUID NOT NULL REFERENCES school_invoices(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  fee_structure_id UUID REFERENCES school_fee_structures(id) ON DELETE SET NULL,
  category_id UUID REFERENCES school_fee_categories(id) ON DELETE SET NULL,

  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,

  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_school_invoices_school
ON school_invoices(school_id);

CREATE INDEX IF NOT EXISTS idx_school_invoices_student
ON school_invoices(student_id);

CREATE INDEX IF NOT EXISTS idx_school_invoices_class
ON school_invoices(class_id);

CREATE INDEX IF NOT EXISTS idx_school_invoices_status
ON school_invoices(status);

CREATE INDEX IF NOT EXISTS idx_school_invoices_session_term
ON school_invoices(academic_session, term);

CREATE INDEX IF NOT EXISTS idx_school_invoice_items_invoice
ON school_invoice_items(invoice_id);

COMMIT;
