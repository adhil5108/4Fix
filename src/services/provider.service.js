import mongoose from 'mongoose';
import Booking, { BOOKING_STATUSES } from '../models/Booking.js';
import Review from '../models/Review.js';
import User, { USER_ROLES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { parseObjectId, toIdString } from '../utils/objectId.js';
import { toPublicProvider } from './providerPresenter.service.js';

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
