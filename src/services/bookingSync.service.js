import Booking, { BOOKING_STATUSES } from '../models/Booking.js';
import Payment, { PAYMENT_CURRENCY, PAYMENT_STATUSES } from '../models/Payment.js';
import Quote from '../models/Quote.js';
import { REQUEST_STATUSES } from '../models/ServiceRequest.js';
import { ApiError } from '../utils/ApiError.js';
import {
  bookingSourceStatuses,
  TERMINAL_BOOKING_STATUSES,
} from '../utils/bookingStateMachine.js';

// A payment record is opened once, when the service is completed, for the accepted
// quote amount. It never reports money as received: mark-paid is a separate step.
export async function ensurePaymentForBooking(booking) {
  const quote = await Quote.findById(booking.quoteId);

  if (!quote) {
    throw new ApiError(409, 'Accepted quote is missing for this booking', 'QUOTE_NOT_FOUND');
  }

  await Payment.updateOne(
    { bookingId: booking.id },
    {
      $setOnInsert: {
        bookingId: booking.id,
        customerId: booking.customerId,
        providerId: booking.providerId,
        amount: quote.amount,
        currency: PAYMENT_CURRENCY,
        status: PAYMENT_STATUSES.PENDING,
        method: null,
        paidAt: null,
        transactionReference: null,
        recordedBy: null,
      },
    },
    { upsert: true },
  );

  return Payment.findOne({ bookingId: booking.id });
}

// Keeps the operational booking in step with the request lifecycle. The request is the
// source of truth; a request that has no booking (plain V1 flow) is left alone.
export async function syncBookingWithRequest(request) {
  const open = { requestId: request.id, bookingStatus: { $nin: TERMINAL_BOOKING_STATUSES } };
  const now = new Date();

  switch (request.status) {
    case REQUEST_STATUSES.SCHEDULED:
      await Booking.updateOne(open, {
        $set: { scheduledDate: request.scheduledDate, scheduledTime: request.scheduledTime },
      });
      return;

    case REQUEST_STATUSES.IN_PROGRESS:
      await Booking.updateOne(
        {
          requestId: request.id,
          bookingStatus: { $in: bookingSourceStatuses(BOOKING_STATUSES.IN_SERVICE) },
        },
        { $set: { bookingStatus: BOOKING_STATUSES.IN_SERVICE, technicianStartedAt: now } },
      );
      return;

    case REQUEST_STATUSES.COMPLETED: {
      await Booking.updateOne(open, {
        $set: { bookingStatus: BOOKING_STATUSES.COMPLETED, completedAt: now },
      });

      const booking = await Booking.findOne({
        requestId: request.id,
        bookingStatus: BOOKING_STATUSES.COMPLETED,
      });

      if (booking) {
        await ensurePaymentForBooking(booking);
      }

      return;
    }

    case REQUEST_STATUSES.CANCELLED:
      await Booking.updateOne(open, { $set: { bookingStatus: BOOKING_STATUSES.CANCELLED } });
      return;

    default:
  }
}
