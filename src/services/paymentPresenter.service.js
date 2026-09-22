import { toIdString } from '../utils/objectId.js';

export function toPayment(payment) {
  if (!payment) {
    return null;
  }

  return {
    id: payment.id,
    bookingId: toIdString(payment.bookingId),
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    method: payment.method ?? null,
    paidAt: payment.paidAt,
    transactionReference: payment.transactionReference ?? null,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}
