'use strict';

const {
  verifySignedToken,
  validatePlatformClaims,
} = require('../security/platformJwt');

function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Missing token'
      });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({
        success: false,
        error: 'JWT_SECRET is not configured'
      });
    }

    const decoded =
      verifySignedToken(
        token,
        {
          secret,
        }
      );

    // SCHOOL_SCOPE_COMPATIBILITY_BRIDGE

    const requestPath = String(req.originalUrl || req.url || '');

    const isSchoolApiPath = /^\/api\/schools?(?:\/|$)/.test(requestPath);


    if (decoded && decoded.scope === 'school') {

      if (!isSchoolApiPath) {

        console.warn('[AUTH_WRONG_TOKEN_SCOPE]', {

          method: req.method,

          path: requestPath,

          scope: decoded.scope,

          claimKeys: Object.keys(decoded || {}),

        });


        return res.status(401).json({

          success: false,

          error: 'Platform authentication token required',

          code: 'WRONG_TOKEN_SCOPE',

        });

      }


      const schoolUserId =

        decoded.userId ||

        decoded.user_id ||

        decoded.sub ||

        null;


      const schoolId =

        decoded.schoolId ||

        decoded.school_id ||

        (decoded.school && decoded.school.id) ||

        null;


      if (!schoolUserId || !schoolId) {

        return res.status(401).json({

          success: false,

          error: 'Incomplete school authentication context',

          code: 'SCHOOL_AUTH_CONTEXT_MISSING',

        });

      }


      decoded.id = String(schoolUserId);

      decoded.userId = String(schoolUserId);

      decoded.schoolId = String(schoolId);

      decoded.role =

        decoded.schoolRole ||

        decoded.school_role ||

        decoded.role ||

        'school_member';


      req.schoolAuth = {

        ...decoded,

        memberId: decoded.memberId || decoded.member_id || null,

        schoolRole: decoded.schoolRole || decoded.school_role || decoded.role,

      };


      req.school = req.schoolAuth;


      console.warn('[SCHOOL_SCOPE_COMPAT_USED]', {

        method: req.method,

        path: requestPath,

      });

    }
      let platformIdentity;

      try {
        platformIdentity =
          validatePlatformClaims(
            decoded
          );
      } catch (error) {
        return res.status(401).json({
          success: false,
          error:
            error?.message ||
            'Invalid token claims',
        });
      }

      req.user =
        platformIdentity;

    next();
  } catch (e) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
}

module.exports = { requireAuth };
