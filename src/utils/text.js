import { ApiError } from './ApiError.js';

export function requiredText(value, fieldName, minLength, maxLength) {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (trimmed.length < minLength) {
    throw new ApiError(
      400,
      `${fieldName} must be at least ${minLength} characters`,
      'VALIDATION_ERROR',
    );
  }

  if (trimmed.length > maxLength) {
    throw new ApiError(
      400,
      `${fieldName} must be ${maxLength} characters or fewer`,
      'VALIDATION_ERROR',
    );
  }

  return trimmed;
}

// Returns null when the value is absent or blank.
export function optionalText(value, fieldName, maxLength) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new ApiError(400, `${fieldName} must be text`, 'VALIDATION_ERROR');
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new ApiError(
      400,
      `${fieldName} must be ${maxLength} characters or fewer`,
      'VALIDATION_ERROR',
    );
  }

  return trimmed.length > 0 ? trimmed : null;
}

export function stringList(value, fieldName, maxItems, maxItemLength) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new ApiError(400, `${fieldName} must be an array`, 'VALIDATION_ERROR');
  }

  if (value.length > maxItems) {
    throw new ApiError(
      400,
      `${fieldName} supports at most ${maxItems} items`,
      'VALIDATION_ERROR',
    );
  }

  return value.map((item) => requiredText(item, `Each item in ${fieldName}`, 1, maxItemLength));
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
