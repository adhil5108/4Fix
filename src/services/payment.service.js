import { BOOKING_STATUSES } from '../models/Booking.js';
import Payment, { PAYMENT_METHODS, PAYMENT_STATUSES } from '../models/Payment.js';
import { ApiError } from '../utils/ApiError.js';
import { optionalText } from '../utils/text.js';
import { findBookingForUser } from './booking.service.js';
import { ensurePaymentForBooking } from './bookingSync.service.js';
import { toPayment } from './paymentPresenter.service.js';

export async function getPayment(user, bookingId) {
  const booking = await findBookingForUser(bookingId, user);
  let payment = await Payment.findOne({ bookingId: booking.id });

  if (!payment) {
    if (booking.bookingStatus !== BOOKING_STATUSES.COMPLETED) {
      throw new ApiError(
        404,
        'Payment is due once the service is completed',
        'PAYMENT_NOT_DUE',
      );
    }

    payment = await ensurePaymentForBooking(booking);
  }

  return {
    payment: toPayment(payment),
  };
}

function parseMethod(value) {
  const method = typeof value === 'string' ? value.trim().toUpperCase() : '';

  if (!Object.values(PAYMENT_METHODS).includes(method)) {
    throw new ApiError(
      400,
      `Method must be one of: ${Object.values(PAYMENT_METHODS).join(', ')}`,
      'VALIDATION_ERROR',
    );
  }

  return method;
}

// Records that the provider (or an admin) received payment directly from the customer.
// There is no gateway yet, so this is a manual record and never a customer self-claim.
export async function markPaymentPaid(user, bookingId, input) {
  const method = parseMethod(input?.method);
  const transactionReference = optionalText(
    input?.transactionReference,
    'Transaction reference',
    120,
  );
  const booking = await findBookingForUser(bookingId, user);

  if (booking.bookingStatus !== BOOKING_STATUSES.COMPLETED) {
    throw new ApiError(
      409,
      'Payment can be recorded once the service is completed',
      'PAYMENT_NOT_DUE',
    );
  }

  const payment = await ensurePaymentForBooking(booking);

  if (payment.status !== PAYMENT_STATUSES.PENDING) {
    throw new ApiError(409, 'This payment is no longer pending', 'PAYMENT_NOT_PENDING');
  }

  const updated = await Payment.findOneAndUpdate(
    { _id: payment.id, status: PAYMENT_STATUSES.PENDING },
    {
      $set: {
        status: PAYMENT_STATUSES.PAID,
        method,
        transactionReference,
        paidAt: new Date(),
        recordedBy: user.id,
      },
    },
    { returnDocument: 'after' },
  );

  if (!updated) {
    throw new ApiError(409, 'Payment was updated, please retry', 'PAYMENT_CONFLICT');
  }

  return {
    payment: toPayment(updated),
  };
}
