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

const defaultAdmissionService = require(
  './liveClassroomAdmissionService'
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

  admissionService =
    defaultAdmissionService,

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
    let authorization =
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

    let effectivePolicy = policy;

    if (
      authorization.participantKind ===
      'student'
    ) {
      const studentAccess =
        await admissionService
          .authorizeStudentLiveClassroomJoin({
            identity:
              normalizedIdentity,
            lessonId:
              normalizedLessonId,
            pool,
          });

      const studentAuthorization =
        studentAccess?.authorization;

      if (
        studentAuthorization
          ?.participantKind !==
          'student' ||
        String(
          studentAuthorization?.role || ''
        )
          .trim()
          .toLowerCase() !==
          'student'
      ) {
        throw serviceError(
          'Student admission authorization context is invalid',
          'SCHOOL_LIVE_CLASSROOM_STUDENT_ADMISSION_CONTEXT_INVALID',
          500
        );
      }

      authorization =
        studentAuthorization;

      effectivePolicy =
        studentAccess.policy ||
        policy;
    }

    const permissions =
      policyService
        .resolveParticipantPermissions({
          role:
            authorization.role,
          policy:
            effectivePolicy,
        });

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
            effectivePolicy.tokenTtlSeconds,
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
            effectivePolicy.tokenTtlSeconds,
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
        effectivePolicy.tokenTtlSeconds,

      expiresAt:
        new Date(
          issuedAt.getTime() +
          effectivePolicy.tokenTtlSeconds * 1000
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
