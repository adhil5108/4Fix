import { toIdString } from '../utils/objectId.js';
import { isPopulated } from './requestPresenter.service.js';
import { toPublicService } from './servicePresenter.service.js';

export function toReview(review, { includeCustomer = false } = {}) {
  if (!review) {
    return null;
  }

  return {
    id: review.id,
    bookingId: toIdString(review.bookingId),
    requestId: toIdString(review.requestId),
    providerId: toIdString(review.providerId),
    rating: review.rating,
    comment: review.comment ?? null,
    // Public listings show the reviewer's display name only.
    ...(includeCustomer
      ? { customer: isPopulated(review.customerId) ? { name: review.customerId.name } : null }
      : {}),
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

// A review in the provider's own "My Reviews" list, with the job it was left on. Expects
// `requestId` (with its `serviceId`) and `bookingId` populated. Only the customer's name
// is included — the provider already saw it on the job — never their phone number or
// anything about the request's access token.
export function toProviderOwnReview(review) {
  const request = isPopulated(review.requestId) ? review.requestId : null;
  const booking = isPopulated(review.bookingId) ? review.bookingId : null;
  const service = request && isPopulated(request.serviceId) ? request.serviceId : null;
  const customerName = request?.customerDetails?.name ||
    (isPopulated(review.customerId) ? review.customerId.name : null);

  return {
    ...toReview(review),
    service: service ? toPublicService(service) : null,
    issueKey: request?.issueKey ?? null,
    issueLabel: request?.issueLabel ?? null,
    completedAt: booking?.completedAt ?? null,
    customer: customerName ? { name: customerName } : null,
  };
}
