'use strict';

const {
    createGradebookEntry,
    listGradebookEntries,
} = require('../../../services/school/gradebook/gradebookService');

function getSchoolId(req) {
    return req.schoolAuth && req.schoolAuth.schoolId;
}

function getMemberId(req) {
    return req.schoolAuth && req.schoolAuth.memberId;
}

exports.createGradebookEntryController = async (req, res, next) => {
    try {

        const entry = await createGradebookEntry(
            getSchoolId(req),
            getMemberId(req),
            req.body
        );

        res.status(201).json({
            success: true,
            message: 'Gradebook entry created successfully',
            data: {
                entry,
            },
        });

    } catch (err) {
        next(err);
    }
};

exports.listGradebookEntriesController = async (req, res, next) => {
    try {

        const entries = await listGradebookEntries(
            getSchoolId(req),
            req.query
        );

        res.json({
            success: true,
            message: 'Gradebook entries fetched successfully',
            data: {
                entries,
                count: entries.length,
            },
        });

    } catch (err) {
        next(err);
    }
};
