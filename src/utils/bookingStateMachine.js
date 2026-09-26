import { BOOKING_STATUSES } from '../models/Booking.js';

// A booking's status only ever follows its request (accept → start → complete), so
// there are no booking-level transitions of its own — just these groupings.
export const TERMINAL_BOOKING_STATUSES = [
  BOOKING_STATUSES.COMPLETED,
  BOOKING_STATUSES.CANCELLED,
];

// List filters: accepted-but-not-started, being worked on, finished, cancelled.
export const BOOKING_STATUS_GROUPS = {
  UPCOMING: [BOOKING_STATUSES.ASSIGNED],
  ACTIVE: [BOOKING_STATUSES.IN_PROGRESS],
  COMPLETED: [BOOKING_STATUSES.COMPLETED],
  CANCELLED: [BOOKING_STATUSES.CANCELLED],
};
