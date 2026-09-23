import { toDateOnlyString } from '../utils/dateTime.js';
import { toIdString } from '../utils/objectId.js';
import { toQuoteForCustomer, toQuoteForProvider } from './quotePresenter.service.js';
import { toPublicService } from './servicePresenter.service.js';
import { toProviderSummary, toUserSummary } from './userPresenter.service.js';

export function isPopulated(value) {
  return Boolean(value) && typeof value === 'object' && value._id !== undefined;
}

export function toAddress(address) {
  if (!address) {
    return null;
  }

  return {
    label: address.label,
    addressLine: address.addressLine,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
  };
}

export function toVoiceNote(voiceNote) {
  if (!voiceNote) {
    return null;
  }

  return {
    url: voiceNote.url,
    format: voiceNote.format ?? null,
    durationSeconds: voiceNote.durationSeconds ?? null,
  };
}

function toRequestBase(request) {
  return {
    id: request.id,
    service: isPopulated(request.serviceId) ? toPublicService(request.serviceId) : null,
    serviceId: toIdString(request.serviceId),
    issueKey: request.issueKey ?? null,
    issueLabel: request.issueLabel ?? null,
    description: request.description,
    attachments: request.attachments,
    voiceNote: toVoiceNote(request.voiceNote),
    address: toAddress(request.address),
    preferredDate: toDateOnlyString(request.preferredDate),
    preferredTime: request.preferredTime,
    status: request.status,
    scheduledDate: toDateOnlyString(request.scheduledDate),
    scheduledTime: request.scheduledTime,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

function toBookingRef(booking) {
  return { id: booking.id, status: booking.bookingStatus };
}

export function toCustomerRequest(request, { quotesCount, booking } = {}) {
  return {
    ...toRequestBase(request),
    selectedProvider: isPopulated(request.selectedProviderId)
      ? toProviderSummary(request.selectedProviderId)
      : null,
    selectedProviderId: toIdString(request.selectedProviderId),
    acceptedQuote: isPopulated(request.acceptedQuoteId)
      ? toQuoteForCustomer(request.acceptedQuoteId)
      : null,
    acceptedQuoteId: toIdString(request.acceptedQuoteId),
    ...(quotesCount === undefined ? {} : { quotesCount }),
    ...(booking === undefined ? {} : { booking: booking ? toBookingRef(booking) : null }),
  };
}

// Discovery listing: no customer identity, only what is needed to price the job.
export function toProviderRequestSummary(request) {
  return toRequestBase(request);
}

export function toProviderRequest(request, { ownQuote } = {}) {
  return {
    ...toRequestBase(request),
    customer: isPopulated(request.customerId) ? toUserSummary(request.customerId) : null,
    selectedProviderId: toIdString(request.selectedProviderId),
    ownQuote: ownQuote ? toQuoteForProvider(ownQuote) : null,
  };
}

// A job the provider has won: the request plus its booking's operational state.
export function toProviderJob(request, booking) {
  return {
    ...toRequestBase(request),
    source: '4FIX',
    customer: isPopulated(request.customerId) ? toUserSummary(request.customerId) : null,
    amount: isPopulated(request.acceptedQuoteId) ? request.acceptedQuoteId.amount : null,
    bookingId: booking ? booking.id : null,
    bookingStatus: booking ? booking.bookingStatus : null,
    tracking: booking
      ? {
          confirmedAt: booking.confirmedAt,
          technicianAssignedAt: booking.technicianAssignedAt,
          onTheWayAt: booking.onTheWayAt,
          arrivedAt: booking.arrivedAt,
          technicianStartedAt: booking.technicianStartedAt,
          completedAt: booking.completedAt,
        }
      : null,
  };
}
