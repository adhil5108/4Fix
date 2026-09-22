import mongoose from 'mongoose';
import Booking, { BOOKING_STATUSES } from '../models/Booking.js';
import Quote, { ACTIVE_QUOTE_STATUSES } from '../models/Quote.js';
import Review from '../models/Review.js';
import Service from '../models/Service.js';
import User, { USER_ROLES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { isSameId, parseObjectId, toIdString } from '../utils/objectId.js';
import { toPublicProvider } from './providerPresenter.service.js';
import { findCustomerRequestOrFail } from './request.service.js';

const MAX_DISCOVERY_RESULTS = 50;

// Rating/review/completed-job counts are derived from Review and Booking documents so
// there is a single source of truth; nothing is cached on the User.
export async function getProviderStats(providerIds) {
  const stats = new Map();

  if (providerIds.length === 0) {
    return stats;
  }

  const ids = providerIds.map((id) => new mongoose.Types.ObjectId(toIdString(id)));
  const [ratings, completed] = await Promise.all([
    Review.aggregate([
      { $match: { providerId: { $in: ids } } },
      { $group: { _id: '$providerId', rating: { $avg: '$rating' }, reviewCount: { $sum: 1 } } },
    ]),
    Booking.aggregate([
      { $match: { providerId: { $in: ids }, bookingStatus: BOOKING_STATUSES.COMPLETED } },
      { $group: { _id: '$providerId', completedJobs: { $sum: 1 } } },
    ]),
  ]);

  for (const row of ratings) {
    stats.set(String(row._id), {
      rating: Math.round(row.rating * 10) / 10,
      reviewCount: row.reviewCount,
      completedJobs: 0,
    });
  }

  for (const row of completed) {
    const current = stats.get(String(row._id)) || { rating: null, reviewCount: 0 };
    stats.set(String(row._id), { ...current, completedJobs: row.completedJobs });
  }

  return stats;
}

export async function findPublicProviderOrFail(providerId) {
  const id = parseObjectId(providerId, 'providerId');
  const provider = await User.findOne({ _id: id, role: USER_ROLES.PROVIDER, isActive: true });

  if (!provider) {
    throw new ApiError(404, 'Provider not found', 'PROVIDER_NOT_FOUND');
  }

  return provider;
}

export async function getPublicProvider(providerId) {
  const provider = await findPublicProviderOrFail(providerId);
  const stats = await getProviderStats([provider.id]);

  return {
    provider: toPublicProvider(provider, stats.get(provider.id)),
  };
}

// Customer-facing discovery: providers who can take this request, with their own quote
// for it (if any). The customer already owns every quote on their request, so this
// exposes nothing they could not see via GET /requests/:id/quotes.
export async function listProvidersForRequest(customer, requestId) {
  const request = await findCustomerRequestOrFail(requestId, customer);
  const [service, quotes] = await Promise.all([
    Service.findById(request.serviceId),
    Quote.find({ requestId: request.id, status: { $in: ACTIVE_QUOTE_STATUSES } }),
  ]);

  const quoteByProvider = new Map(quotes.map((quote) => [toIdString(quote.providerId), quote]));
  const eligibility = { isAvailable: true };

  if (service?.category) {
    // Providers without declared categories are treated as general providers.
    eligibility.$or = [
      { serviceCategories: { $size: 0 } },
      { serviceCategories: service.category },
    ];
  }

  const providers = await User.find({
    role: USER_ROLES.PROVIDER,
    isActive: true,
    $or: [eligibility, { _id: { $in: [...quoteByProvider.keys()] } }],
  })
    .sort({ createdAt: 1 })
    .limit(MAX_DISCOVERY_RESULTS);

  const stats = await getProviderStats(providers.map((provider) => provider.id));

  const list = providers.map((provider) => {
    const quote = quoteByProvider.get(provider.id);

    return {
      ...toPublicProvider(provider, stats.get(provider.id)),
      isSelected: isSameId(request.selectedProviderId, provider.id),
      quote: quote
        ? {
            id: quote.id,
            amount: quote.amount,
            description: quote.description,
            status: quote.status,
          }
        : null,
    };
  });

  list.sort(
    (left, right) =>
      Number(right.isSelected) - Number(left.isSelected) ||
      Number(Boolean(right.quote)) - Number(Boolean(left.quote)) ||
      (right.rating ?? 0) - (left.rating ?? 0),
  );

  return {
    requestId: request.id,
    providers: list,
  };
}
