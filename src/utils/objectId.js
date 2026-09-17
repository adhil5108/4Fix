import mongoose from 'mongoose';
import { ApiError } from './ApiError.js';

export function parseObjectId(value, fieldName) {
  if (typeof value !== 'string' || !mongoose.Types.ObjectId.isValid(value)) {
    throw new ApiError(400, `${fieldName} is invalid`, 'VALIDATION_ERROR');
  }

  return new mongoose.Types.ObjectId(value);
}

export function toIdString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value?._id ?? value);
}

export function isSameId(left, right) {
  const leftId = toIdString(left);
  const rightId = toIdString(right);

  return leftId !== null && rightId !== null && leftId === rightId;
}
