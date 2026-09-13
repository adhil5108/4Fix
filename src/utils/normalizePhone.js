import { ApiError } from './ApiError.js';

export function normalizePhoneNumber(phoneNumber) {
  if (typeof phoneNumber !== 'string') {
    throw new ApiError(400, 'Phone number is required', 'VALIDATION_ERROR');
  }

  const normalized = phoneNumber.trim().replace(/[\s().-]/g, '');

  if (!/^\+?[1-9]\d{7,14}$/.test(normalized)) {
    throw new ApiError(400, 'Phone number is invalid', 'VALIDATION_ERROR');
  }

  return normalized;
}
