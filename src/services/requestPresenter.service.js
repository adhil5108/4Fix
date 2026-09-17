import { toDateOnlyString } from '../utils/dateTime.js';
import { toIdString } from '../utils/objectId.js';
import { toQuoteForCustomer, toQuoteForProvider } from './quotePresenter.service.js';
import { toPublicService } from './servicePresenter.service.js';
import { toUserSummary } from './userPresenter.service.js';

function isPopulated(value) {
  return Boolean(value) && typeof value === 'object' && value._id !== undefined;
}

function toAddress(address) {
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

function toRequestBase(request) {
  return {
    id: request.id,
    service: isPopulated(request.serviceId) ? toPublicService(request.serviceId) : null,
    serviceId: toIdString(request.serviceId),
    description: request.description,
    attachments: request.attachments,
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

export function toCustomerRequest(request, { quotesCount } = {}) {
  return {
    ...toRequestBase(request),
    selectedProvider: isPopulated(request.selectedProviderId)
      ? toUserSummary(request.selectedProviderId)
      : null,
    selectedProviderId: toIdString(request.selectedProviderId),
    acceptedQuote: isPopulated(request.acceptedQuoteId)
      ? toQuoteForCustomer(request.acceptedQuoteId)
      : null,
    acceptedQuoteId: toIdString(request.acceptedQuoteId),
    ...(quotesCount === undefined ? {} : { quotesCount }),
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
