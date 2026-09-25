import { REQUEST_STATUSES } from '../models/ServiceRequest.js';
import { ApiError } from './ApiError.js';

// V1: a request is open (PENDING) until exactly one provider accepts it.
const ALLOWED_TRANSITIONS = {
  [REQUEST_STATUSES.PENDING]: [REQUEST_STATUSES.ACCEPTED, REQUEST_STATUSES.CANCELLED],
  [REQUEST_STATUSES.ACCEPTED]: [REQUEST_STATUSES.SCHEDULED],
  [REQUEST_STATUSES.SCHEDULED]: [REQUEST_STATUSES.IN_PROGRESS],
  [REQUEST_STATUSES.IN_PROGRESS]: [REQUEST_STATUSES.COMPLETED],
  [REQUEST_STATUSES.COMPLETED]: [],
  [REQUEST_STATUSES.CANCELLED]: [],
};

// Statuses in which providers may discover and accept a request.
export const OPEN_REQUEST_STATUSES = [REQUEST_STATUSES.PENDING];

export function canTransition(fromStatus, toStatus) {
  return (ALLOWED_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

export function assertTransition(fromStatus, toStatus) {
  if (!canTransition(fromStatus, toStatus)) {
    throw new ApiError(
      409,
      `A ${fromStatus} request cannot change to ${toStatus}`,
      'INVALID_STATE_TRANSITION',
    );
  }
}
