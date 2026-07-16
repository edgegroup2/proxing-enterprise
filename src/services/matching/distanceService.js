'use strict';

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeLower(value) {
  return String(value || '').trim().toLowerCase();
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const a1 = safeNumber(lat1);
  const o1 = safeNumber(lon1);
  const a2 = safeNumber(lat2);
  const o2 = safeNumber(lon2);

  if ([a1, o1, a2, o2].some((v) => v === null)) return null;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;

  const dLat = toRad(a2 - a1);
  const dLon = toRad(o2 - o1);

  const q =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a1)) * Math.cos(toRad(a2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));

  return R * c;
}

function scoreDistance(distanceKm) {
  if (distanceKm === null) return 0;
  if (distanceKm <= 5) return 1;
  if (distanceKm <= 15) return 0.9;
  if (distanceKm <= 30) return 0.8;
  if (distanceKm <= 75) return 0.65;
  if (distanceKm <= 150) return 0.45;
  if (distanceKm <= 300) return 0.25;
  return 0.05;
}

function locationSimilarity(source, target) {
  const sourceLocation = normalizeLower(source?.location_text);
  const targetLocation = normalizeLower(target?.location_text);

  const exactTextMatch =
    Boolean(sourceLocation) &&
    Boolean(targetLocation) &&
    sourceLocation === targetLocation;

  const distanceKm = haversineKm(
    source?.latitude,
    source?.longitude,
    target?.latitude,
    target?.longitude
  );

  if (exactTextMatch) {
    return {
      score: 1,
      distanceKm: distanceKm ?? 0,
      reason: 'exact-location-text'
    };
  }

  if (distanceKm !== null) {
    return {
      score: scoreDistance(distanceKm),
      distanceKm,
      reason: 'coordinate-distance'
    };
  }

  if (sourceLocation && targetLocation) {
    const left = sourceLocation.split(',').map((x) => x.trim()).filter(Boolean);
    const right = targetLocation.split(',').map((x) => x.trim()).filter(Boolean);

    const overlap = left.some((part) => right.includes(part));
    if (overlap) {
      return {
        score: 0.55,
        distanceKm: null,
        reason: 'partial-location-overlap'
      };
    }
  }

  return {
    score: 0,
    distanceKm: null,
    reason: 'unknown-location'
  };
}

module.exports = {
  haversineKm,
  locationSimilarity
};
