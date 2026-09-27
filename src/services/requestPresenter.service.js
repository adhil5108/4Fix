import { toDateOnlyString } from '../utils/dateTime.js';
import { buildNavigationUrl } from '../utils/location.js';
import { toIdString } from '../utils/objectId.js';
import { toPublicService } from './servicePresenter.service.js';
import { toProviderSummary } from './userPresenter.service.js';

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

// Customer coordinates are sensitive: only call this for audiences authorized to see
// them (the customer, the selected provider, booking participants, admin).
// Before a provider is assigned, browsing providers see only the area of a typed
// address (enough to decide whether to accept), never the street line.
function toAddressArea(address) {
  if (!address) {
    return null;
  }

  return {
    label: null,
    addressLine: null,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
  };
}

export function toServiceLocation(location) {
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
    return null;
  }

  return {
    latitude: location.latitude,
    longitude: location.longitude,
    address: location.address ?? null,
    navigationUrl: buildNavigationUrl(location.latitude, location.longitude),
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

// The customer's contact for this request: the name/phone they gave when requesting
// (V1), or — for a pre-V1 request made from a customer account — that account's name.
// Private: only for the customer themself, the assigned provider and admin.
export function toCustomerContact(request, legacyCustomer = request?.customerId) {
  if (request?.customerDetails?.name) {
    return { name: request.customerDetails.name, phone: request.customerDetails.phone ?? null };
  }

  return isPopulated(legacyCustomer) ? { name: legacyCustomer.name, phone: null } : null;
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
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

function toBookingRef(booking) {
  return { id: booking.id, status: booking.bookingStatus };
}

// The assigned provider's contact for the customer: name and the phone number they
// registered with (their account username, which is the normalized phone). Null until a
// provider accepts. Served only on request-token-authorized customer responses (and
// admin views) — never on the provider feeds, which use the provider presenters below.
function toAssignedProviderContact(request) {
  const provider = request.selectedProviderId;

  return isPopulated(provider) ? { name: provider.name, phone: provider.username ?? null } : null;
}

export function toCustomerRequest(request, { booking } = {}) {
  return {
    ...toRequestBase(request),
    location: toServiceLocation(request.location),
    customerDetails: toCustomerContact(request),
    selectedProvider: isPopulated(request.selectedProviderId)
      ? toProviderSummary(request.selectedProviderId)
      : null,
    selectedProviderId: toIdString(request.selectedProviderId),
    provider: toAssignedProviderContact(request),
    acceptedAt: request.acceptedAt ?? null,
    ...(booking === undefined ? {} : { booking: booking ? toBookingRef(booking) : null }),
  };
}

// Discovery listing: no customer name/phone, coordinates or street address.
export function toProviderRequestSummary(request) {
  return { ...toRequestBase(request), address: toAddressArea(request.address) };
}

// `includeLocation` must only be true for the provider assigned to the request: it
// unlocks the exact location and the customer's contact details together.
export function toProviderRequest(request, { includeLocation = false, booking } = {}) {
  return {
    ...toRequestBase(request),
    address: includeLocation ? toAddress(request.address) : toAddressArea(request.address),
    location: includeLocation ? toServiceLocation(request.location) : null,
    customer: includeLocation ? toCustomerContact(request) : null,
    selectedProviderId: toIdString(request.selectedProviderId),
    acceptedAt: request.acceptedAt ?? null,
    bookingId: booking ? booking.id : null,
  };
}

// A job the provider accepted: the request plus its booking's operational state.
export function toProviderJob(request, booking) {
  return {
    ...toRequestBase(request),
    location: toServiceLocation(request.location),
    source: '4FIX',
    customer: toCustomerContact(request),
    bookingId: booking ? booking.id : null,
    bookingStatus: booking ? booking.bookingStatus : null,
    timeline: booking
      ? {
          acceptedAt: booking.confirmedAt,
          startedAt: booking.technicianStartedAt ?? null,
          completedAt: booking.completedAt ?? null,
        }
      : null,
  };
}
