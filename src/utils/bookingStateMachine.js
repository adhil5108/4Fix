import { BOOKING_STATUSES } from '../models/Booking.js';
import { ApiError } from './ApiError.js';

// Operational tracking on top of the request lifecycle. IN_SERVICE and COMPLETED
// are only ever reached by following the request (start/complete), never directly.
const ALLOWED_TRANSITIONS = {
  [BOOKING_STATUSES.CONFIRMED]: [
    BOOKING_STATUSES.ASSIGNED,
    BOOKING_STATUSES.ON_THE_WAY,
    BOOKING_STATUSES.IN_SERVICE,
    BOOKING_STATUSES.CANCELLED,
  ],
  [BOOKING_STATUSES.ASSIGNED]: [
    BOOKING_STATUSES.ON_THE_WAY,
    BOOKING_STATUSES.IN_SERVICE,
    BOOKING_STATUSES.CANCELLED,
  ],
  [BOOKING_STATUSES.ON_THE_WAY]: [
    BOOKING_STATUSES.ARRIVED,
    BOOKING_STATUSES.IN_SERVICE,
    BOOKING_STATUSES.CANCELLED,
  ],
  [BOOKING_STATUSES.ARRIVED]: [BOOKING_STATUSES.IN_SERVICE, BOOKING_STATUSES.CANCELLED],
  [BOOKING_STATUSES.IN_SERVICE]: [BOOKING_STATUSES.COMPLETED],
  [BOOKING_STATUSES.COMPLETED]: [],
  [BOOKING_STATUSES.CANCELLED]: [],
};

export const TERMINAL_BOOKING_STATUSES = [
  BOOKING_STATUSES.COMPLETED,
  BOOKING_STATUSES.CANCELLED,
];

// Customer-facing groupings for the bookings list.
export const BOOKING_STATUS_GROUPS = {
  UPCOMING: [BOOKING_STATUSES.CONFIRMED, BOOKING_STATUSES.ASSIGNED],
  ACTIVE: [
    BOOKING_STATUSES.ON_THE_WAY,
    BOOKING_STATUSES.ARRIVED,
    BOOKING_STATUSES.IN_SERVICE,
  ],
  COMPLETED: [BOOKING_STATUSES.COMPLETED],
  CANCELLED: [BOOKING_STATUSES.CANCELLED],
};

export function canBookingTransition(fromStatus, toStatus) {
  return (ALLOWED_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

// Every status that may move directly to the given one.
export function bookingSourceStatuses(toStatus) {
  return Object.keys(ALLOWED_TRANSITIONS).filter((fromStatus) =>
    canBookingTransition(fromStatus, toStatus),
  );
}

export function assertBookingTransition(fromStatus, toStatus) {
  if (!canBookingTransition(fromStatus, toStatus)) {
    throw new ApiError(
      409,
      `A ${fromStatus} booking cannot change to ${toStatus}`,
      'INVALID_STATE_TRANSITION',
    );
  }
}
