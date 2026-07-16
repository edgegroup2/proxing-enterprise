BEGIN;

ALTER TABLE school_payments
ADD COLUMN IF NOT EXISTS receipt_no TEXT;

ALTER TABLE school_payments
ADD COLUMN IF NOT EXISTS receipt_issued_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_school_payments_school_receipt_no
ON school_payments(school_id, receipt_no)
WHERE receipt_no IS NOT NULL;

COMMIT;
