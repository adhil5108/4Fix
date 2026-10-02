import { toCategoryRef } from './categoryPresenter.service.js';

export function toSafeUser(user) {
  const safeUser = {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    phoneVerifiedAt: user.phoneVerifiedAt,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };

  if (user.role === 'PROVIDER') {
    safeUser.profileImage = user.profileImage ?? null;
    safeUser.bio = user.bio ?? null;
    safeUser.categories = (user.categories || []).map(toCategoryRef);
    safeUser.experienceYears = user.experienceYears ?? null;
    safeUser.isAvailable = user.isAvailable !== false;
    // Own profile and admin views only — never part of the public provider profile.
    safeUser.shopLocation = user.shopLocation
      ? {
          latitude: user.shopLocation.latitude ?? null,
          longitude: user.shopLocation.longitude ?? null,
          address: user.shopLocation.address ?? null,
        }
      : null;
  }

  return safeUser;
}

export function toUserSummary(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
  };
}

// What a customer sees about their technician inside a request or booking.
export function toProviderSummary(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    profileImage: user.profileImage ?? null,
  };
}
