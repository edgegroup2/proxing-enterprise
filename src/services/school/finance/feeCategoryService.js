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

function normalizeStatus(value) {
    const status = clean(value) || 'active';
    const allowed = ['active', 'inactive', 'archived'];

    if (!allowed.includes(status)) {
        const err = new Error('Status must be active, inactive, or archived');
        err.statusCode = 400;
        throw err;
    }

    return status;
}

async function createFeeCategory(schoolId, payload = {}) {
    const pool = getPool();

    const result = await pool.query(
        `
        INSERT INTO school_fee_categories (
            school_id,
            name,
            code,
            description,
            is_optional,
            status
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING *
        `,
        [
            schoolId,
            requireText(payload.name, 'Fee category name'),
            clean(payload.code),
            clean(payload.description),
            !!payload.isOptional,
            normalizeStatus(payload.status),
        ]
    );

    return result.rows[0];
}

async function listFeeCategories(schoolId, query = {}) {
    const pool = getPool();
    const params = [schoolId];

    let where = `
        school_id = $1
        AND deleted_at IS NULL
    `;

    if (clean(query.status)) {
        params.push(normalizeStatus(query.status));
        where += ` AND status = $${params.length}`;
    }

    const result = await pool.query(
        `
        SELECT *
        FROM school_fee_categories
        WHERE ${where}
        ORDER BY name ASC
        `,
        params
    );

    return result.rows;
}

async function updateFeeCategory(schoolId, categoryId, payload = {}) {
    const pool = getPool();

    const result = await pool.query(
        `
        UPDATE school_fee_categories
        SET
            name = COALESCE($3, name),
            code = COALESCE($4, code),
            description = COALESCE($5, description),
            is_optional = COALESCE($6, is_optional),
            status = COALESCE($7, status),
            updated_at = now()
        WHERE id = $1
          AND school_id = $2
          AND deleted_at IS NULL
        RETURNING *
        `,
        [
            categoryId,
            schoolId,
            clean(payload.name),
            clean(payload.code),
            clean(payload.description),
            payload.isOptional === undefined ? null : !!payload.isOptional,
            payload.status === undefined ? null : normalizeStatus(payload.status),
        ]
    );

    if (!result.rows.length) {
        const err = new Error('Fee category not found');
        err.statusCode = 404;
        throw err;
    }

    return result.rows[0];
}

async function deleteFeeCategory(schoolId, categoryId) {
    const pool = getPool();

    const result = await pool.query(
        `
        UPDATE school_fee_categories
        SET deleted_at = now(),
            updated_at = now()
        WHERE id = $1
          AND school_id = $2
          AND deleted_at IS NULL
        RETURNING *
        `,
        [categoryId, schoolId]
    );

    if (!result.rows.length) {
        const err = new Error('Fee category not found');
        err.statusCode = 404;
        throw err;
    }

    return result.rows[0];
}

module.exports = {
    createFeeCategory,
    listFeeCategories,
    updateFeeCategory,
    deleteFeeCategory,
};
