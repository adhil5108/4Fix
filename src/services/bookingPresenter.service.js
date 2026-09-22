import { toDateOnlyString } from '../utils/dateTime.js';
import { toIdString } from '../utils/objectId.js';
import { isPopulated, toAddress } from './requestPresenter.service.js';
import { toPublicService } from './servicePresenter.service.js';
import { toProviderSummary, toUserSummary } from './userPresenter.service.js';

function toBookingRequest(request) {
  if (!isPopulated(request)) {
    return null;
  }

  return {
    id: request.id,
    status: request.status,
    issueKey: request.issueKey ?? null,
    issueLabel: request.issueLabel ?? null,
    description: request.description,
    attachments: request.attachments,
    address: toAddress(request.address),
    preferredDate: toDateOnlyString(request.preferredDate),
    preferredTime: request.preferredTime,
  };
}

function toTimeline(booking) {
  return {
    confirmedAt: booking.confirmedAt,
    technicianAssignedAt: booking.technicianAssignedAt,
    onTheWayAt: booking.onTheWayAt,
    arrivedAt: booking.arrivedAt,
    technicianStartedAt: booking.technicianStartedAt,
    completedAt: booking.completedAt,
  };
}

function toLocation(location) {
  if (!location) {
    return null;
  }

  return {
    latitude: location.latitude,
    longitude: location.longitude,
    updatedAt: location.updatedAt,
  };
}

// `status` is the booking's operational status; the request lifecycle is `requestStatus`.
function toBookingBase(booking) {
  const request = booking.requestId;
  const service = isPopulated(request) ? request.serviceId : null;

  return {
    id: booking.id,
    requestId: toIdString(booking.requestId),
    quoteId: toIdString(booking.quoteId),
    status: booking.bookingStatus,
    requestStatus: isPopulated(request) ? request.status : null,
    service: isPopulated(service) ? toPublicService(service) : null,
    request: toBookingRequest(request),
    amount: isPopulated(booking.quoteId) ? booking.quoteId.amount : null,
    confirmedAt: booking.confirmedAt,
    scheduledDate: toDateOnlyString(booking.scheduledDate),
    scheduledTime: booking.scheduledTime,
    timeline: toTimeline(booking),
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
}

export function toBookingForCustomer(booking) {
  return {
    ...toBookingBase(booking),
    provider: isPopulated(booking.providerId) ? toProviderSummary(booking.providerId) : null,
    providerId: toIdString(booking.providerId),
    arrivalCode: booking.arrivalCode,
  };
}

// The arrival code is the customer's to hand over, so providers never receive it.
export function toBookingForProvider(booking) {
  return {
    ...toBookingBase(booking),
    customer: isPopulated(booking.customerId) ? toUserSummary(booking.customerId) : null,
    customerId: toIdString(booking.customerId),
  };
}

// ETA and distance stay null until a real tracking integration exists.
export function toTracking(booking) {
  return {
    bookingId: booking.id,
    status: booking.bookingStatus,
    requestStatus: isPopulated(booking.requestId) ? booking.requestId.status : null,
    provider: isPopulated(booking.providerId) ? toProviderSummary(booking.providerId) : null,
    scheduledDate: toDateOnlyString(booking.scheduledDate),
    scheduledTime: booking.scheduledTime,
    eta: null,
    distance: null,
    lastLocation: toLocation(booking.lastLocation),
    timeline: toTimeline(booking),
    updatedAt: booking.updatedAt,
  };
}
