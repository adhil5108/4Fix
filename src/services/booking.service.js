import crypto from 'node:crypto';
import Booking, { BOOKING_STATUSES } from '../models/Booking.js';
import { REQUEST_STATUSES } from '../models/ServiceRequest.js';
import { USER_ROLES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import {
  assertBookingTransition,
  BOOKING_STATUS_GROUPS,
  TERMINAL_BOOKING_STATUSES,
} from '../utils/bookingStateMachine.js';
import { parseDateOnly } from '../utils/dateTime.js';
import { isSameId, parseObjectId } from '../utils/objectId.js';
import {
  toBookingForCustomer,
  toBookingForProvider,
  toTracking,
} from './bookingPresenter.service.js';
import { getProviderStats } from './provider.service.js';
import { toPublicProvider } from './providerPresenter.service.js';
import { findCustomerRequestOrFail, presentCustomerRequestById } from './request.service.js';

// A booking can be confirmed once a quote is accepted, even if the provider has
// already scheduled the visit.
const CONFIRMABLE_REQUEST_STATUSES = [
  REQUEST_STATUSES.QUOTE_ACCEPTED,
  REQUEST_STATUSES.SCHEDULED,
];

const BOOKING_POPULATE = [
  { path: 'requestId', populate: { path: 'serviceId' } },
  { path: 'quoteId' },
  { path: 'providerId' },
  { path: 'customerId' },
];

function generateArrivalCode() {
  return String(crypto.randomInt(1000, 10000));
}

function loadBooking(bookingId) {
  return Booking.findById(bookingId).populate(BOOKING_POPULATE);
}

function presentForUser(booking, user) {
  return user.role === USER_ROLES.PROVIDER
    ? toBookingForProvider(booking)
    : toBookingForCustomer(booking);
}

export function assertBookingAccess(booking, user) {
  if (user.role === USER_ROLES.ADMIN) {
    return;
  }

  const owner =
    user.role === USER_ROLES.CUSTOMER
      ? booking.customerId
      : user.role === USER_ROLES.PROVIDER
        ? booking.providerId
        : null;

  if (!isSameId(owner, user.id)) {
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

export async function confirmBooking(customer, requestId) {
  const request = await findCustomerRequestOrFail(requestId, customer);
  let booking = await Booking.findOne({ requestId: request.id });

  if (!booking) {
    if (
      !CONFIRMABLE_REQUEST_STATUSES.includes(request.status) ||
      !request.selectedProviderId ||
      !request.acceptedQuoteId
    ) {
      throw new ApiError(
        409,
        'Accept a quote before confirming the booking',
        'REQUEST_NOT_CONFIRMABLE',
      );
    }

    try {
      booking = await Booking.create({
        requestId: request.id,
        customerId: request.customerId,
        providerId: request.selectedProviderId,
        quoteId: request.acceptedQuoteId,
        bookingStatus: BOOKING_STATUSES.CONFIRMED,
        confirmedAt: new Date(),
        scheduledDate: request.scheduledDate,
        scheduledTime: request.scheduledTime,
        arrivalCode: generateArrivalCode(),
      });
    } catch (error) {
      // Two confirmations raced; the unique requestId index kept a single booking.
      if (error?.code !== 11000) {
        throw error;
      }

      booking = await Booking.findOne({ requestId: request.id });
    }
  }

  const detailed = await loadBooking(booking.id);
  const stats = await getProviderStats([detailed.providerId.id]);

  return {
    request: await presentCustomerRequestById(request.id),
    provider: toPublicProvider(detailed.providerId, stats.get(detailed.providerId.id)),
    booking: toBookingForCustomer(detailed),
    // Only claims the backend can actually back. Verification/insurance do not exist yet.
    safety: {
      providerVerified: false,
      insuranceIncluded: false,
      arrivalCode: detailed.arrivalCode,
    },
  };
}

function parseBookingStatusFilter(value) {
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

export async function listBookings(user, query) {
  const filter =
    user.role === USER_ROLES.PROVIDER ? { providerId: user.id } : { customerId: user.id };
  const status = parseBookingStatusFilter(query?.status);

  if (status) {
    filter.bookingStatus = status;
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

export async function getTracking(user, bookingId) {
  const booking = await findBookingForUser(bookingId, user);

  return {
    tracking: toTracking(await loadBooking(booking.id)),
  };
}

async function applyTrackingTransition(provider, bookingId, targetStatus, extraFields) {
  const booking = await findBookingOrFail(bookingId);

  if (!isSameId(booking.providerId, provider.id)) {
    throw new ApiError(403, 'Access denied', 'FORBIDDEN');
  }

  assertBookingTransition(booking.bookingStatus, targetStatus);

  const updated = await Booking.findOneAndUpdate(
    { _id: booking.id, providerId: provider.id, bookingStatus: booking.bookingStatus },
    { $set: { bookingStatus: targetStatus, ...extraFields } },
    { returnDocument: 'after' },
  ).populate(BOOKING_POPULATE);

  if (!updated) {
    throw new ApiError(409, 'Booking was updated, please retry', 'BOOKING_CONFLICT');
  }

  return {
    booking: toBookingForProvider(updated),
  };
}

export function assignBooking(provider, bookingId) {
  return applyTrackingTransition(provider, bookingId, BOOKING_STATUSES.ASSIGNED, {
    technicianAssignedAt: new Date(),
  });
}

export function markOnTheWay(provider, bookingId) {
  return applyTrackingTransition(provider, bookingId, BOOKING_STATUSES.ON_THE_WAY, {
    onTheWayAt: new Date(),
  });
}

export function markArrived(provider, bookingId) {
  return applyTrackingTransition(provider, bookingId, BOOKING_STATUSES.ARRIVED, {
    arrivedAt: new Date(),
  });
}

function parseCoordinate(value, fieldName, limit) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -limit || value > limit) {
    throw new ApiError(
      400,
      `${fieldName} must be a number between -${limit} and ${limit}`,
      'VALIDATION_ERROR',
    );
  }

  return value;
}

export async function updateLocation(provider, bookingId, input) {
  const latitude = parseCoordinate(input?.latitude, 'Latitude', 90);
  const longitude = parseCoordinate(input?.longitude, 'Longitude', 180);
  const booking = await findBookingOrFail(bookingId);

  if (!isSameId(booking.providerId, provider.id)) {
    throw new ApiError(403, 'Access denied', 'FORBIDDEN');
  }

  if (TERMINAL_BOOKING_STATUSES.includes(booking.bookingStatus)) {
    throw new ApiError(409, 'This booking is closed', 'BOOKING_CLOSED');
  }

  const updated = await Booking.findOneAndUpdate(
    {
      _id: booking.id,
      providerId: provider.id,
      bookingStatus: { $nin: TERMINAL_BOOKING_STATUSES },
    },
    { $set: { lastLocation: { latitude, longitude, updatedAt: new Date() } } },
    { returnDocument: 'after' },
  ).populate(BOOKING_POPULATE);

  if (!updated) {
    throw new ApiError(409, 'Booking was updated, please retry', 'BOOKING_CONFLICT');
  }

  return {
    tracking: toTracking(updated),
  };
}
