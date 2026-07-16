'use strict';

const {
  listSchoolMembers,
  inviteSchoolMember,
  updateSchoolMemberStatus,
} = require('../../../services/school/members/schoolMembersService');

function getSchoolId(req) {
  return req.schoolAuth && req.schoolAuth.schoolId;
}

async function listMembersController(req, res) {
  try {
    const schoolId = getSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({
        success: false,
        message: 'School authentication is required',
      });
    }

    const members = await listSchoolMembers(schoolId);

    return res.json({
      success: true,
      message: 'School members fetched successfully',
      data: {
        members,
        count: members.length,
      },
    });
  } catch (err) {
    console.error('SCHOOL_MEMBERS_LIST_ERROR:', err);

    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch school members',
    });
  }
}

async function inviteMemberController(req, res) {
  try {
    const schoolId = getSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({
        success: false,
        message: 'School authentication is required',
      });
    }

    const member = await inviteSchoolMember(schoolId, req.body);

    return res.status(201).json({
      success: true,
      message: 'School member invited successfully',
      data: {
        member,
      },
    });
  } catch (err) {
    console.error('SCHOOL_MEMBER_INVITE_ERROR:', err);

    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to invite school member',
    });
  }
}

async function updateMemberStatusController(req, res) {
  try {
    const schoolId = getSchoolId(req);
    const { memberId } = req.params;
    const { status } = req.body || {};

    if (!schoolId) {
      return res.status(401).json({
        success: false,
        message: 'School authentication is required',
      });
    }

    const member = await updateSchoolMemberStatus(schoolId, memberId, status);

    return res.json({
      success: true,
      message: 'School member status updated successfully',
      data: {
        member,
      },
    });
  } catch (err) {
    console.error('SCHOOL_MEMBER_STATUS_ERROR:', err);

    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to update school member status',
    });
  }
}

module.exports = {
  listMembersController,
  inviteMemberController,
  updateMemberStatusController,
};
