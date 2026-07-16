'use strict';

const db = require('../../../db');

function getPool() {
  if (db.pool && typeof db.pool.query === 'function') return db.pool;
  if (typeof db.query === 'function') return db;
  throw new Error('Database pool is not available');
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function requireText(value, label) {
  const text = clean(value);
  if (!text) {
    const err = new Error(`${label} is required`);
    err.statusCode = 400;
    throw err;
  }
  return text;
}

async function generateInvoice(schoolId, studentId, academicSession, term) {
  const pool = getPool();

  studentId = requireText(studentId, 'Student ID');
  academicSession = requireText(academicSession, 'Academic session');
  term = requireText(term, 'Term');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const studentResult = await client.query(
      `
SELECT s.id, e.class_id
FROM school_students s
JOIN student_class_enrollments e ON e.student_id = s.id
WHERE s.id = $1
  AND s.school_id = $2
  AND s.deleted_at IS NULL
  AND e.school_id = $2
  AND e.status = 'active'
ORDER BY e.created_at DESC
LIMIT 1
      `,
      [studentId, schoolId]
    );

    if (!studentResult.rows.length) {
      const err = new Error('Student not found');
      err.statusCode = 404;
      throw err;
    }

    const student = studentResult.rows[0];

    if (!student.class_id) {
      const err = new Error('Student has no class assigned');
      err.statusCode = 400;
      throw err;
    }

const feeResult = await client.query(
  `
  SELECT
    fs.id AS fee_structure_id,
    fs.category_id,
    fs.amount,
    fc.name AS category_name,
    fc.code AS category_code
  FROM school_fee_structures fs
  JOIN school_fee_categories fc ON fc.id = fs.category_id
  WHERE fs.school_id = $1
    AND fs.class_id = $2
    AND fs.academic_session = $3
    AND fs.term = $4
    AND fs.status = 'active'
    AND fs.deleted_at IS NULL
    AND fc.deleted_at IS NULL
  ORDER BY fc.name ASC
  `,
  [schoolId, student.class_id, academicSession, term]
);

if (!feeResult.rows.length) {
  const err = new Error('No active fee structures found for this student class, session, and term');
  err.statusCode = 404;
  throw err;
}

const feeItems = feeResult.rows.map((item) => ({
  feeStructureId: item.fee_structure_id,
  categoryId: item.category_id,
  description: item.category_name,
  categoryCode: item.category_code,
  amount: Number(item.amount),
}));

const subtotal = feeItems.reduce((sum, item) => sum + item.amount, 0);

const yearCode = academicSession.replace(/[^0-9]/g, '').slice(0, 4) || '0000';

const countResult = await client.query(
  `
  SELECT COUNT(*)::int AS count
  FROM school_invoices
  WHERE school_id = $1
  `,
  [schoolId]
);

const nextNumber = countResult.rows[0].count + 1;
const invoiceNo = `INV-${yearCode}-${String(nextNumber).padStart(6, '0')}`;

const discountAmount = 0;
const totalAmount = subtotal;
const paidAmount = 0;
const balanceAmount = totalAmount;

const invoiceResult = await client.query(
  `
  INSERT INTO school_invoices (
    school_id,
    student_id,
    class_id,
    invoice_no,
    academic_session,
    term,
    subtotal,
    discount_amount,
    total_amount,
    paid_amount,
    balance_amount,
    status
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  RETURNING *
  `,
  [
    schoolId,
    student.id,
    student.class_id,
    invoiceNo,
    academicSession,
    term,
    subtotal,
    discountAmount,
    totalAmount,
    paidAmount,
    balanceAmount,
    'unpaid',
  ]
);

const invoice = invoiceResult.rows[0];

for (const item of feeItems) {
  await client.query(
    `
    INSERT INTO school_invoice_items (
      invoice_id,
      school_id,
      fee_structure_id,
      category_id,
      description,
      amount
    )
    VALUES ($1,$2,$3,$4,$5,$6)
    `,
    [
      invoice.id,
      schoolId,
      item.feeStructureId,
      item.categoryId,
      item.description,
      item.amount,
    ]
  );
}

await client.query('COMMIT');

return {
  invoice,
  items: feeItems,
  message: 'Invoice generated successfully',
};
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  generateInvoice,
};
