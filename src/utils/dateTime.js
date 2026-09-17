import { ApiError } from './ApiError.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseDateOnly(value, fieldName) {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (!DATE_PATTERN.test(trimmed)) {
    throw new ApiError(400, `${fieldName} must use the YYYY-MM-DD format`, 'VALIDATION_ERROR');
  }

  const date = new Date(`${trimmed}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed) {
    throw new ApiError(400, `${fieldName} is not a valid date`, 'VALIDATION_ERROR');
  }

  return date;
}

export function normalizeTimeOfDay(value, fieldName) {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (!TIME_PATTERN.test(trimmed)) {
    throw new ApiError(400, `${fieldName} must use the 24-hour HH:mm format`, 'VALIDATION_ERROR');
  }

  return trimmed;
}

export function assertNotPastDate(date, fieldName) {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  if (date.getTime() < startOfToday.getTime()) {
    throw new ApiError(400, `${fieldName} cannot be in the past`, 'VALIDATION_ERROR');
  }
}

export function toDateOnlyString(date) {
  if (!date) {
    return null;
  }

  return new Date(date).toISOString().slice(0, 10);
}
