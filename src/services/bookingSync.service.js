import Booking, { BOOKING_STATUSES } from '../models/Booking.js';
import { REQUEST_STATUSES } from '../models/ServiceRequest.js';
import { TERMINAL_BOOKING_STATUSES } from '../utils/bookingStateMachine.js';

// Keeps the operational booking in step with the request lifecycle. The request is the
// source of truth; a request that has no booking yet is left alone.
export async function syncBookingWithRequest(request) {
  const open = { requestId: request.id, bookingStatus: { $nin: TERMINAL_BOOKING_STATUSES } };
  const now = new Date();

  switch (request.status) {
    case REQUEST_STATUSES.IN_PROGRESS:
      await Booking.updateOne(
        { requestId: request.id, bookingStatus: BOOKING_STATUSES.ASSIGNED },
        { $set: { bookingStatus: BOOKING_STATUSES.IN_PROGRESS, technicianStartedAt: now } },
      );
      return;

    // Money is settled outside 4Fix, so completion opens no payment record.
    case REQUEST_STATUSES.COMPLETED:
      await Booking.updateOne(open, {
        $set: { bookingStatus: BOOKING_STATUSES.COMPLETED, completedAt: now },
      });
      return;

    case REQUEST_STATUSES.CANCELLED:
      await Booking.updateOne(open, { $set: { bookingStatus: BOOKING_STATUSES.CANCELLED } });
      return;

    default:
  }
}
