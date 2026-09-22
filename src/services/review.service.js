import { BOOKING_STATUSES } from '../models/Booking.js';
import Review from '../models/Review.js';
import { ApiError } from '../utils/ApiError.js';
import { optionalText } from '../utils/text.js';
import { findBookingForUser } from './booking.service.js';
import { findPublicProviderOrFail, getProviderStats } from './provider.service.js';
import { toReview } from './reviewPresenter.service.js';
import { toUserSummary } from './userPresenter.service.js';

const MAX_PROVIDER_REVIEWS = 100;

function parseRating(value) {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new ApiError(400, 'Rating must be a whole number from 1 to 5', 'VALIDATION_ERROR');
  }

  return value;
}

export async function createReview(customer, bookingId, input) {
  const rating = parseRating(input?.rating);
  const comment = optionalText(input?.comment, 'Comment', 1000);
  const booking = await findBookingForUser(bookingId, customer);

  if (booking.bookingStatus !== BOOKING_STATUSES.COMPLETED) {
    throw new ApiError(
      409,
      'You can review once the service is completed',
      'BOOKING_NOT_COMPLETED',
    );
  }

  const existing = await Review.exists({ bookingId: booking.id, customerId: customer.id });

  if (existing) {
    throw new ApiError(409, 'You have already reviewed this booking', 'REVIEW_EXISTS');
  }

  let review;

  try {
    review = await Review.create({
      bookingId: booking.id,
      requestId: booking.requestId,
      customerId: customer.id,
      providerId: booking.providerId,
      rating,
      comment,
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new ApiError(409, 'You have already reviewed this booking', 'REVIEW_EXISTS');
    }

    throw error;
  }

  return {
    review: toReview(review),
  };
}

export async function getReview(user, bookingId) {
  const booking = await findBookingForUser(bookingId, user);
  const review = await Review.findOne({ bookingId: booking.id });

  if (!review) {
    throw new ApiError(404, 'No review for this booking yet', 'REVIEW_NOT_FOUND');
  }

  return {
    review: toReview(review),
  };
}

// Public: what customers see on a provider profile.
export async function listProviderReviews(providerId) {
  const provider = await findPublicProviderOrFail(providerId);
  const [reviews, stats] = await Promise.all([
    Review.find({ providerId: provider.id })
      .sort({ createdAt: -1 })
      .limit(MAX_PROVIDER_REVIEWS)
      .populate({ path: 'customerId' }),
    getProviderStats([provider.id]),
  ]);
  const providerStats = stats.get(provider.id) || { rating: null, reviewCount: 0 };

  return {
    provider: toUserSummary(provider),
    summary: {
      rating: providerStats.rating,
      reviewCount: providerStats.reviewCount,
    },
    reviews: reviews.map((review) => toReview(review, { includeCustomer: true })),
  };
}
