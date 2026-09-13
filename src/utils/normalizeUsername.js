import { ApiError } from './ApiError.js';
import { normalizePhoneNumber } from './normalizePhone.js';

export function normalizeUsername(username) {
  if (typeof username !== 'string' || username.trim().length === 0) {
    throw new ApiError(400, 'Username is required', 'VALIDATION_ERROR');
  }

  const trimmedUsername = username.trim();

  try {
    return normalizePhoneNumber(trimmedUsername);
  } catch (_error) {
    return trimmedUsername.toLowerCase();
  }
}
