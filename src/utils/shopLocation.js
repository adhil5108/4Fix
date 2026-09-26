import { ApiError } from './ApiError.js';
import { parseCoordinate } from './location.js';
import { optionalText } from './text.js';

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
