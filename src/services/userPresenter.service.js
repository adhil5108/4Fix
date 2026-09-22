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
    safeUser.serviceCategories = user.serviceCategories || [];
    safeUser.experienceYears = user.experienceYears ?? null;
    safeUser.isAvailable = user.isAvailable !== false;
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

// What a customer sees about their technician inside a booking/quote.
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
