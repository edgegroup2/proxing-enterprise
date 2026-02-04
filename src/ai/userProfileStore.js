// src/ai/userProfileStore.js
const profiles = new Map();

function getUserProfile(phone) {
  if (!profiles.has(phone)) {
    profiles.set(phone, {});
  }
  return profiles.get(phone);
}

function updateUserProfile(phone, intent) {
  const profile = getUserProfile(phone);

  if (intent.disco) profile.lastDisco = intent.disco;
  if (intent.meter) profile.lastMeter = intent.meter;
  if (intent.iuc) profile.lastIUC = intent.iuc;
  if (intent.service) profile.lastService = intent.service;
  if (intent.network) profile.lastNetwork = intent.network;

  profiles.set(phone, profile);
}

module.exports = {
  getUserProfile,
  updateUserProfile,
};
