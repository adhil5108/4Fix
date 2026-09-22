import { BOOKING_POPULATE } from './booking.service.js';
import Booking from '../models/Booking.js';
import Quote from '../models/Quote.js';
import Review from '../models/Review.js';
import User, { USER_ROLES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { parseObjectId } from '../utils/objectId.js';
import { parsePagination, toPageResult } from '../utils/pagination.js';
import { escapeRegex } from '../utils/text.js';
import { toBookingForProvider } from './bookingPresenter.service.js';
import { toQuoteForProvider } from './quotePresenter.service.js';
import { getProviderStats } from './provider.service.js';
import { toReview } from './reviewPresenter.service.js';
import { toSafeUser } from './userPresenter.service.js';

const RECENT_LIMIT = 20;

function withStats(provider, stats) {
  const providerStats = stats.get(provider.id) || {};

  return {
    ...toSafeUser(provider),
    rating: providerStats.rating ?? null,
    reviewCount: providerStats.reviewCount ?? 0,
    completedJobs: providerStats.completedJobs ?? 0,
  };
}

export async function listAdminProviders(query) {
  const pagination = parsePagination(query);
  const filter = { role: USER_ROLES.PROVIDER };

  if (query?.isActive === 'true') {
    filter.isActive = true;
  } else if (query?.isActive === 'false') {
    filter.isActive = false;
  }

  if (query?.category) {
    filter.serviceCategories = String(query.category).trim().toUpperCase();
  }

  if (query?.search) {
    const pattern = new RegExp(escapeRegex(String(query.search).trim()), 'i');
    filter.$or = [{ name: pattern }, { username: pattern }];
  }

  const [providers, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.pageSize),
    User.countDocuments(filter),
  ]);

  const stats = await getProviderStats(providers.map((provider) => provider.id));

  return toPageResult(
    'providers',
    providers.map((provider) => withStats(provider, stats)),
    pagination,
    total,
  );
}

export async function findAdminProviderOrFail(providerId) {
  const id = parseObjectId(providerId, 'providerId');
  const provider = await User.findOne({ _id: id, role: USER_ROLES.PROVIDER });

  if (!provider) {
    throw new ApiError(404, 'Provider not found', 'PROVIDER_NOT_FOUND');
  }

  return provider;
}

export async function getAdminProvider(providerId) {
  const provider = await findAdminProviderOrFail(providerId);
  const [stats, quotes, bookings, reviews] = await Promise.all([
    getProviderStats([provider.id]),
    Quote.find({ providerId: provider.id }).sort({ createdAt: -1 }).limit(RECENT_LIMIT),
    Booking.find({ providerId: provider.id })
      .sort({ createdAt: -1 })
      .limit(RECENT_LIMIT)
      .populate(BOOKING_POPULATE),
    Review.find({ providerId: provider.id })
      .sort({ createdAt: -1 })
      .limit(RECENT_LIMIT)
      .populate({ path: 'customerId' }),
  ]);

  return {
    provider: withStats(provider, stats),
    quotes: quotes.map(toQuoteForProvider),
    bookings: bookings.map(toBookingForProvider),
    reviews: reviews.map((review) => toReview(review, { includeCustomer: true })),
  };
}

export async function setAdminProviderStatus(providerId, isActive) {
  if (typeof isActive !== 'boolean') {
    throw new ApiError(400, 'isActive must be true or false', 'VALIDATION_ERROR');
  }

  const provider = await findAdminProviderOrFail(providerId);
  const updated = await User.findOneAndUpdate(
    { _id: provider.id, role: USER_ROLES.PROVIDER },
    { $set: { isActive } },
    { returnDocument: 'after' },
  );

  const stats = await getProviderStats([updated.id]);

  return { provider: withStats(updated, stats) };
}
