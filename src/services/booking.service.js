import Booking, { BOOKING_STATUSES } from '../models/Booking.js';
import { USER_ROLES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { BOOKING_STATUS_GROUPS } from '../utils/bookingStateMachine.js';
import { isSameId, parseObjectId } from '../utils/objectId.js';
import { toBookingForCustomer, toBookingForProvider } from './bookingPresenter.service.js';

// Exported so the admin booking service can reuse the exact same populate shape
// instead of redefining it.
export const BOOKING_POPULATE = [
  { path: 'requestId', populate: { path: 'serviceId' } },
  { path: 'providerId' },
  { path: 'customerId' },
];

export function loadBooking(bookingId) {
  return Booking.findById(bookingId).populate(BOOKING_POPULATE);
}

function presentForUser(booking, user) {
  return user.role === USER_ROLES.PROVIDER
    ? toBookingForProvider(booking)
    : toBookingForCustomer(booking);
}

// Providers reach only their own jobs; an anonymous customer only the job created from
// the one request their access token belongs to; ADMIN reads platform-wide.
export function assertBookingAccess(booking, user) {
  if (user.role === USER_ROLES.ADMIN) {
    return;
  }

  const allowed =
    user.role === USER_ROLES.PROVIDER
      ? isSameId(booking.providerId, user.id)
      : user.role === USER_ROLES.CUSTOMER && isSameId(booking.requestId, user.requestId);

  if (!allowed) {
    throw new ApiError(403, 'Access denied', 'FORBIDDEN');
  }
}

export async function findBookingOrFail(bookingId) {
  const id = parseObjectId(bookingId, 'bookingId');
  const booking = await Booking.findById(id);

  if (!booking) {
    throw new ApiError(404, 'Booking not found', 'BOOKING_NOT_FOUND');
  }

  return booking;
}

export async function findBookingForUser(bookingId, user) {
  const booking = await findBookingOrFail(bookingId);

  assertBookingAccess(booking, user);

  return booking;
}

// Creates the job for a request its provider has just accepted. Idempotent: the unique
// requestId index guarantees one booking per request, so a repeated or racing call
// returns the existing booking instead of creating a second one.
export async function ensureBookingForAcceptedRequest(request) {
  const existing = await Booking.findOne({ requestId: request.id });

  if (existing) {
    return existing;
  }

  try {
    return await Booking.create({
      requestId: request.id,
      customerId: request.customerId ?? null,
      providerId: request.selectedProviderId,
      bookingStatus: BOOKING_STATUSES.ASSIGNED,
      confirmedAt: new Date(),
    });
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }

    return Booking.findOne({ requestId: request.id });
  }
}

// Exported so the admin booking service can reuse the same status/group parsing.
export function parseBookingStatusFilter(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const status = String(value).trim().toUpperCase();

  if (BOOKING_STATUS_GROUPS[status]) {
    return { $in: BOOKING_STATUS_GROUPS[status] };
  }

  if (Object.values(BOOKING_STATUSES).includes(status)) {
    return status;
  }

  const allowed = [...Object.keys(BOOKING_STATUS_GROUPS), ...Object.values(BOOKING_STATUSES)];

  throw new ApiError(400, `Status must be one of: ${allowed.join(', ')}`, 'VALIDATION_ERROR');
}

// A provider lists their own jobs; a customer the (at most one) job for their request.
// ADMIN is allowed here only for the area preview and always gets an empty list.
export async function listBookings(user, query) {
  if (user.role === USER_ROLES.ADMIN) {
    parseBookingStatusFilter(query?.status);
    return { bookings: [] };
  }

  const filter =
    user.role === USER_ROLES.PROVIDER ? { providerId: user.id } : { requestId: user.requestId };
  const status = parseBookingStatusFilter(query?.status);

  if (status) {
    filter.bookingStatus = status;
  }

  const bookings = await Booking.find(filter).sort({ createdAt: -1 }).populate(BOOKING_POPULATE);

  return {
    bookings: bookings.map((booking) => presentForUser(booking, user)),
  };
}

export async function getBooking(user, bookingId) {
  const booking = await findBookingForUser(bookingId, user);

  return {
    booking: presentForUser(await loadBooking(booking.id), user),
  };
}
