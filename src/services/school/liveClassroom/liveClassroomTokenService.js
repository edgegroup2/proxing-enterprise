'use strict';

const {
  readLiveClassroomConfig,
} = require('../../../config/liveClassroomConfig');

const {
  createLiveClassroomProvider,
} = require('../../../providers/liveClassroom');

const defaultPolicyService = require(
  './liveClassroomPolicyService'
);

const defaultSessionService = require(
  './liveClassroomSessionService'
);

const SAFE_IDENTIFIER =
  /^[A-Za-z0-9_-]+$/;

function serviceError(
  message,
  code,
  statusCode
) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function requireSafeIdentifier(
  value,
  label
) {
  const normalized =
    typeof value === 'string'
      ? value.trim()
      : '';

  if (
    !normalized ||
    !SAFE_IDENTIFIER.test(normalized)
  ) {
    throw serviceError(
      `${label} is invalid`,
      'SCHOOL_LIVE_CLASSROOM_IDENTIFIER_INVALID',
      400
    );
  }

  return normalized;
}

function buildLiveClassroomRoomName(
  schoolId,
  lessonId
) {
  const safeSchoolId = requireSafeIdentifier(
    schoolId,
    'School identifier'
  );

  const safeLessonId = requireSafeIdentifier(
    lessonId,
    'Lesson identifier'
  );

  return [
    'proxing',
    'school',
    safeSchoolId,
    'lesson',
    safeLessonId,
  ].join('_');
}

function buildParticipantIdentity(identity) {
  const schoolId = requireSafeIdentifier(
    identity?.schoolId,
    'School identifier'
  );

  const memberId = requireSafeIdentifier(
    identity?.memberId,
    'Member identifier'
  );

  const userId = requireSafeIdentifier(
    identity?.userId,
    'User identifier'
  );

  return [
    'school',
    schoolId,
    'member',
    memberId,
    'user',
    userId,
  ].join('_');
}

function normalizeIdentity(identity) {
  return Object.freeze({
    schoolId: requireSafeIdentifier(
      identity?.schoolId,
      'School identifier'
    ),

    memberId: requireSafeIdentifier(
      identity?.memberId,
      'Member identifier'
    ),

    userId: requireSafeIdentifier(
      identity?.userId,
      'User identifier'
    ),

  });
}

function createLiveClassroomTokenService({
  configurationProvider =
    readLiveClassroomConfig,

  policyService =
    defaultPolicyService,

  sessionService =
    defaultSessionService,

  providerFactory =
    createLiveClassroomProvider,

  now = () => new Date(),
} = {}) {
  async function issueLiveClassroomJoinToken({
    identity,
    lessonId,
    pool,
  }) {
    const normalizedIdentity =
      normalizeIdentity(identity);

    const normalizedLessonId =
      requireSafeIdentifier(
        lessonId,
        'Lesson identifier'
      );

    const configuration =
      configurationProvider();

    const policy =
      await policyService
        .getSchoolLiveClassroomPolicy({
          schoolId:
            normalizedIdentity.schoolId,
          pool,
          configuration,
        });

    if (!policy.enabled) {
      throw serviceError(
        'Live Classroom is disabled for this school',
        'SCHOOL_LIVE_CLASSROOM_DISABLED',
        403
      );
    }

    if (
      policy.recordingEnabled ||
      configuration
        .recordingEnabledDefault
    ) {
      throw serviceError(
        'Live Classroom recording is not enabled in this release',
        'SCHOOL_LIVE_CLASSROOM_RECORDING_UNAVAILABLE',
        409
      );
    }

    if (!configuration.livekit.configured) {
      throw serviceError(
        'LiveKit is not configured',
        'SCHOOL_LIVEKIT_NOT_CONFIGURED',
        503
      );
    }

    const authorization =
      await sessionService
        .authorizeLessonLiveClassroomAccess({
          schoolId:
            normalizedIdentity.schoolId,
          lessonId:
            normalizedLessonId,
          identity:
            normalizedIdentity,
          pool,
        });

    const permissions =
      policyService
        .resolveParticipantPermissions({
          role:
            authorization.role,
          policy,
        });

    if (
      authorization.participantKind ===
      'student'
    ) {
      throw serviceError(
        'Student enrollment and waiting-room admission are not yet available',
        'SCHOOL_LIVE_CLASSROOM_STUDENT_ADMISSION_REQUIRED',
        403
      );
    }

    const roomName =
      buildLiveClassroomRoomName(
        normalizedIdentity.schoolId,
        normalizedLessonId
      );

    const participantIdentity =
      buildParticipantIdentity(
        normalizedIdentity
      );

    const session =
      await sessionService
        .ensureLiveClassroomSession({
          schoolId:
            normalizedIdentity.schoolId,
          lessonId:
            normalizedLessonId,
          roomName,
          hostMemberId:
            permissions.participantKind ===
            'host'
              ? normalizedIdentity.memberId
              : null,
          pool,
        });

    const provider =
      providerFactory(
        configuration
      );

    const issuedAt = now();

    const providerResult =
      await provider
        .issueParticipantToken({
          roomName,
          participantIdentity,
          participantName:
            normalizedIdentity.memberId,
          ttlSeconds:
            policy.tokenTtlSeconds,
          permissions,
          metadata: {
            version: 1,
            product:
              'proxing-school-live-classroom',
            schoolId:
              normalizedIdentity.schoolId,
            lessonId:
              normalizedLessonId,
            sessionId:
              String(session.id),
            memberId:
              normalizedIdentity.memberId,
            userId:
              normalizedIdentity.userId,
            role:
              authorization.role,
            participantKind:
              permissions.participantKind,
          },
        });

    await sessionService
      .recordLiveClassroomEvent({
        schoolId:
          normalizedIdentity.schoolId,
        sessionId:
          session.id,
        lessonId:
          normalizedLessonId,
        eventType:
          'participant_token_issued',
        actorMemberId:
          normalizedIdentity.memberId,
        actorUserId:
          normalizedIdentity.userId,
        payload: {
          provider:
            providerResult.provider,
          roomName,
          participantIdentity,
          participantKind:
            permissions.participantKind,
          canPublish:
            permissions.canPublish,
          canSubscribe:
            permissions.canSubscribe,
          expiresInSeconds:
            policy.tokenTtlSeconds,
        },
        pool,
      });

    return Object.freeze({
      provider:
        providerResult.provider,
      serverUrl:
        providerResult.url,
      participantToken:
        providerResult.token,

      lessonId:
        normalizedLessonId,

      sessionId:
        String(session.id),

      roomName,
      participantIdentity,

      permissions,

      expiresInSeconds:
        policy.tokenTtlSeconds,

      expiresAt:
        new Date(
          issuedAt.getTime() +
          policy.tokenTtlSeconds * 1000
        ).toISOString(),

      recordingEnabled: false,
    });
  }

  return Object.freeze({
    issueLiveClassroomJoinToken,
  });
}

const defaultService =
  createLiveClassroomTokenService();

module.exports = {
  SAFE_IDENTIFIER,
  buildLiveClassroomRoomName,
  buildParticipantIdentity,
  createLiveClassroomTokenService,

  issueLiveClassroomJoinToken:
    defaultService
      .issueLiveClassroomJoinToken,
};
