import { ApiError } from './ApiError.js';
import { optionalText, requiredText } from './text.js';

// The provider's shop/business name, kept apart from the address. Never derived from
// the address: providers registered before this field existed have none until they add
// it from their profile.
export function validateShopName(value, { required = true } = {}) {
  if (!required) {
    const name = optionalText(value, 'Shop name', 120);

    return name === null ? null : requiredText(name, 'Shop name', 2, 120);
  }

  return requiredText(value, 'Shop name', 2, 120);
}

// The typed shop address is the shop location, at signup and from the profile. It uses
// the same length rules as a service address line (5–240). Providers never enter
// coordinates and the device location is never requested; nothing is geocoded.
// Coordinates already stored on older profiles are kept as they are (`existing`) — they
// are no longer collected or shown, but existing records are not rewritten.
export function validateShopLocation(input, { existing = null } = {}) {
  if (input === undefined || input === null) {
    throw new ApiError(400, 'Shop location is required', 'VALIDATION_ERROR');
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, 'Shop location must be an object', 'VALIDATION_ERROR');
  }

  return {
    latitude: existing?.latitude ?? null,
    longitude: existing?.longitude ?? null,
    address: requiredText(input.address, 'Shop address', 5, 240),
  };
}
