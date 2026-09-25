import { ApiError } from './ApiError.js';

export function parseCoordinate(value, fieldName, limit) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -limit || value > limit) {
    throw new ApiError(
      400,
      `${fieldName} must be a number between -${limit} and ${limit}`,
      'VALIDATION_ERROR',
    );
  }

  return value;
}

// Universal Google Maps directions link: opens the Maps app on phones and the web
// otherwise, with the coordinates as destination. No API key involved.
export function buildNavigationUrl(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}
