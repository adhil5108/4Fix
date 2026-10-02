import Booking, { BOOKING_STATUSES } from '../models/Booking.js';
import Invoice, { Counter } from '../models/Invoice.js';
import ServiceRequest from '../models/ServiceRequest.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { findBookingForUser } from './booking.service.js';
import { toInvoice } from './invoicePresenter.service.js';
import { toCustomerContact } from './requestPresenter.service.js';

async function nextInvoiceNumber() {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'invoice' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );

  return `4F-${String(counter.seq).padStart(6, '0')}`;
}

// Creates the invoice for a request's job once that job is COMPLETED; returns null for
// any job that isn't (open, accepted, in progress, cancelled). Idempotent: a retried
// completion, a racing call or a later read all end up with the same single invoice.
export async function ensureInvoiceForCompletedRequest(requestId) {
  const booking = await Booking.findOne({ requestId });

  if (!booking || booking.bookingStatus !== BOOKING_STATUSES.COMPLETED) {
    return null;
  }

  const existing = await Invoice.findOne({ bookingId: booking._id });

  if (existing) {
    return existing;
  }

  const [request, provider] = await Promise.all([
    ServiceRequest.findById(booking.requestId).populate([{ path: 'serviceId' }, { path: 'customerId' }]),
    User.findById(booking.providerId),
  ]);

  try {
    return await Invoice.create({
      invoiceNumber: await nextInvoiceNumber(),
      bookingId: booking._id,
      requestId: booking.requestId,
      providerId: booking.providerId,
      // The provider's phone is their account username (the normalized number).
      provider: { name: provider?.name ?? null, phone: provider?.username ?? null },
      customer: toCustomerContact(request),
      serviceId: request.serviceId._id,
      serviceName: request.serviceId.name,
      issueKey: request.issueKey ?? null,
      issueLabel: request.issueLabel ?? null,
      description: request.description ?? null,
      completedAt: booking.completedAt ?? booking.updatedAt,
    });
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }

    return Invoice.findOne({ bookingId: booking._id });
  }
}

// GET /api/bookings/:bookingId/invoice. Access is exactly the booking's: the customer
// holding that request's token, the assigned provider, or admin (findBookingForUser).
// Jobs completed before invoices existed get theirs on first view.
export async function getBookingInvoice(user, bookingId) {
  const booking = await findBookingForUser(bookingId, user);

  if (booking.bookingStatus !== BOOKING_STATUSES.COMPLETED) {
    throw new ApiError(404, 'An invoice is available once the job is completed', 'INVOICE_NOT_FOUND');
  }

  const invoice =
    (await Invoice.findOne({ bookingId: booking._id })) ??
    (await ensureInvoiceForCompletedRequest(booking.requestId));

  return { invoice: toInvoice(invoice) };
}
