import { toDateOnlyString } from '../utils/dateTime.js';
import { toIdString } from '../utils/objectId.js';
import {
  isPopulated,
  toAddress,
  toServiceLocation,
  toVoiceNote,
} from './requestPresenter.service.js';
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
    voiceNote: toVoiceNote(request.voiceNote),
    address: toAddress(request.address),
    location: toServiceLocation(request.location),
    preferredDate: toDateOnlyString(request.preferredDate),
    preferredTime: request.preferredTime,
  };
}

// accepted → started → completed; there are no travel/arrival steps in V1.
function toTimeline(booking) {
  return {
    acceptedAt: booking.confirmedAt,
    startedAt: booking.technicianStartedAt ?? null,
    completedAt: booking.completedAt ?? null,
  };
}

// `status` is the booking's operational status; the request lifecycle is `requestStatus`.
function toBookingBase(booking) {
  const request = booking.requestId;
  const service = isPopulated(request) ? request.serviceId : null;

  return {
    id: booking.id,
    requestId: toIdString(booking.requestId),
    status: booking.bookingStatus,
    requestStatus: isPopulated(request) ? request.status : null,
    service: isPopulated(service) ? toPublicService(service) : null,
    request: toBookingRequest(request),
    confirmedAt: booking.confirmedAt,
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
  };
}

export function toBookingForProvider(booking) {
  return {
    ...toBookingBase(booking),
    customer: isPopulated(booking.customerId) ? toUserSummary(booking.customerId) : null,
    customerId: toIdString(booking.customerId),
  };
}

// Admin needs both identities at once (unlike a participant, who already knows who
// they are) — composed from the customer view rather than duplicating its fields.
export function toBookingForAdmin(booking) {
  return {
    ...toBookingForCustomer(booking),
    customer: isPopulated(booking.customerId) ? toUserSummary(booking.customerId) : null,
    customerId: toIdString(booking.customerId),
  };
}
