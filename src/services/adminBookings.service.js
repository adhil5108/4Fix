import Booking from '../models/Booking.js';
import { ApiError } from '../utils/ApiError.js';
import { parseDateOnly } from '../utils/dateTime.js';
import { parseObjectId } from '../utils/objectId.js';
import { parsePagination, toPageResult } from '../utils/pagination.js';
import { BOOKING_POPULATE, parseBookingStatusFilter } from './booking.service.js';
import { toBookingForAdmin } from './bookingPresenter.service.js';

export async function listAdminBookings(query) {
  const pagination = parsePagination(query);
  const filter = {};

  const status = parseBookingStatusFilter(query?.status);
  if (status) {
    filter.bookingStatus = status;
  }

  if (query?.provider) {
    filter.providerId = parseObjectId(query.provider, 'provider');
  }

  if (query?.customer) {
    filter.customerId = parseObjectId(query.customer, 'customer');
  }

  if (query?.from || query?.to) {
    filter.scheduledDate = {};

    if (query.from) {
      filter.scheduledDate.$gte = parseDateOnly(query.from, 'From date');
    }

    if (query.to) {
      filter.scheduledDate.$lte = parseDateOnly(query.to, 'To date');
    }
  }

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.pageSize)
      .populate(BOOKING_POPULATE),
    Booking.countDocuments(filter),
  ]);

  // Admin sees both identities at once — the arrival code too, matching the access
  // level GET /api/bookings/:id already grants ADMIN.
  return toPageResult('bookings', bookings.map(toBookingForAdmin), pagination, total);
}

export async function getAdminBooking(bookingId) {
  const id = parseObjectId(bookingId, 'bookingId');
  const booking = await Booking.findById(id).populate(BOOKING_POPULATE);

  if (!booking) {
    throw new ApiError(404, 'Booking not found', 'BOOKING_NOT_FOUND');
  }

  return { booking: toBookingForAdmin(booking) };
}
