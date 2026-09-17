import { REQUEST_STATUSES } from '../models/ServiceRequest.js';
import { ApiError } from './ApiError.js';

const ALLOWED_TRANSITIONS = {
  [REQUEST_STATUSES.PENDING]: [
    REQUEST_STATUSES.QUOTE_RECEIVED,
    REQUEST_STATUSES.CANCELLED,
  ],
  [REQUEST_STATUSES.QUOTE_RECEIVED]: [
    REQUEST_STATUSES.QUOTE_ACCEPTED,
    REQUEST_STATUSES.CANCELLED,
  ],
  [REQUEST_STATUSES.QUOTE_ACCEPTED]: [REQUEST_STATUSES.SCHEDULED],
  [REQUEST_STATUSES.SCHEDULED]: [REQUEST_STATUSES.IN_PROGRESS],
  [REQUEST_STATUSES.IN_PROGRESS]: [REQUEST_STATUSES.COMPLETED],
  [REQUEST_STATUSES.COMPLETED]: [],
  [REQUEST_STATUSES.CANCELLED]: [],
};

// Statuses in which providers may still discover a request and submit a quote.
export const QUOTABLE_REQUEST_STATUSES = [
  REQUEST_STATUSES.PENDING,
  REQUEST_STATUSES.QUOTE_RECEIVED,
];

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
