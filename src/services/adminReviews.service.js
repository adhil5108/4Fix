import Review from '../models/Review.js';
import { ApiError } from '../utils/ApiError.js';
import { parseObjectId } from '../utils/objectId.js';
import { parsePagination, toPageResult } from '../utils/pagination.js';
import { toReview } from './reviewPresenter.service.js';

export async function listAdminReviews(query) {
  const pagination = parsePagination(query);
  const filter = {};

  if (query?.provider) {
    filter.providerId = parseObjectId(query.provider, 'provider');
  }

  if (query?.customer) {
    filter.customerId = parseObjectId(query.customer, 'customer');
  }

  if (query?.rating) {
    const rating = Number(query.rating);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ApiError(400, 'rating must be a whole number from 1 to 5', 'VALIDATION_ERROR');
    }

    filter.rating = rating;
  }

  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.pageSize)
      .populate({ path: 'customerId' }),
    Review.countDocuments(filter),
  ]);

  return toPageResult(
    'reviews',
    reviews.map((review) => toReview(review, { includeCustomer: true })),
    pagination,
    total,
  );
}

export async function getAdminReview(reviewId) {
  const id = parseObjectId(reviewId, 'reviewId');
  const review = await Review.findById(id).populate({ path: 'customerId' });

  if (!review) {
    throw new ApiError(404, 'Review not found', 'REVIEW_NOT_FOUND');
  }

  return { review: toReview(review, { includeCustomer: true }) };
}
