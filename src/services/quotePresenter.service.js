import { toIdString } from '../utils/objectId.js';
import { toUserSummary } from './userPresenter.service.js';

function isPopulated(value) {
  return Boolean(value) && typeof value === 'object' && value._id !== undefined;
}

function toQuoteBase(quote) {
  return {
    id: quote.id,
    requestId: toIdString(quote.requestId),
    amount: quote.amount,
    description: quote.description,
    status: quote.status,
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
  };
}

// Customers compare quotes across providers, so the provider is identified.
export function toQuoteForCustomer(quote) {
  if (!quote) {
    return null;
  }

  return {
    ...toQuoteBase(quote),
    provider: isPopulated(quote.providerId) ? toUserSummary(quote.providerId) : null,
    providerId: toIdString(quote.providerId),
  };
}

// Providers only ever see their own quotes, so no competitor data is exposed.
export function toQuoteForProvider(quote) {
  if (!quote) {
    return null;
  }

  return {
    ...toQuoteBase(quote),
    providerId: toIdString(quote.providerId),
  };
}
