import { ApiError } from './ApiError.js';
import { parseCoordinate } from './location.js';
import { optionalText, requiredText } from './text.js';

// Profile editing: coordinates are required (captured from the device or entered).
export function validateShopLocation(input, { required = true } = {}) {
  if (input === undefined || input === null) {
    if (required) {
      throw new ApiError(400, 'Shop location is required', 'VALIDATION_ERROR');
    }

    return null;
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, 'Shop location must be an object', 'VALIDATION_ERROR');
  }

  return {
    latitude: parseCoordinate(input.latitude, 'Latitude', 90),
    longitude: parseCoordinate(input.longitude, 'Longitude', 180),
    address: optionalText(input.address, 'Shop address', 240) || null,
  };
}

// Provider registration: the typed shop/business address is the shop location. It uses
// the same length rules as a service address line (5–240). Coordinates are neither
// required nor derived from the address (no geocoding); they stay null until the
// provider sets them from their profile.
export function validateSignupShopLocation(input) {
  if (input === undefined || input === null) {
    throw new ApiError(400, 'Shop location is required', 'VALIDATION_ERROR');
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, 'Shop location must be an object', 'VALIDATION_ERROR');
  }

  return {
    latitude: null,
    longitude: null,
    address: requiredText(input.address, 'Shop address', 5, 240),
  };
}
