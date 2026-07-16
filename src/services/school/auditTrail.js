const db = require("../../db");

function getPool() {
    if (db.pool && typeof db.pool.query === "function") return db.pool;
    if (typeof db.query === "function") return db;
    throw new Error("Database pool is not available");
}

async function logSchoolEvent({
    schoolId,
    actorUserId = null,
    fromStatus = null,
    toStatus,
    note = null
}) {

    const pool = getPool();

    await pool.query(
        `
        INSERT INTO school_application_events
        (
            school_id,
            actor_user_id,
            from_status,
            to_status,
            note
        )
        VALUES ($1,$2,$3,$4,$5)
        `,
        [
            schoolId,
            actorUserId,
            fromStatus,
            toStatus,
            note
        ]
    );
}

async function getSchoolTimeline(schoolId) {

    const pool = getPool();

    const result = await pool.query(
        `
        SELECT
            e.*,
            u.full_name
        FROM school_application_events e
        LEFT JOIN users u
            ON u.id = e.actor_user_id
        WHERE e.school_id = $1
        ORDER BY e.created_at DESC
        `,
        [schoolId]
    );

    return result.rows;
}

module.exports = {
    logSchoolEvent,
    getSchoolTimeline
};
