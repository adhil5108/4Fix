import { toIdString } from '../utils/objectId.js';
import { isPopulated } from './requestPresenter.service.js';

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
