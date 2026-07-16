'use strict';

/**
 * Agora token generation requires `agora-access-token` package:
 * npm i agora-access-token
 */
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

function buildRtcToken({ channelName, uid, expireSeconds = 3600 }) {
  const appId = process.env.AGORA_APP_ID;
  const appCert = process.env.AGORA_APP_CERTIFICATE;
  if (!appId || !appCert) throw new Error('Agora env missing');

  const now = Math.floor(Date.now() / 1000);
  const privilegeExpire = now + Number(expireSeconds);

  return RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCert,
    channelName,
    Number(uid),
    RtcRole.PUBLISHER,
    privilegeExpire
  );
}

module.exports = { buildRtcToken };
