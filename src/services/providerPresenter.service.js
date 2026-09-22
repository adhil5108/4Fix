// Public provider profile: no username/phone, no auth fields.
export function toPublicProvider(user, stats = {}) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    profileImage: user.profileImage ?? null,
    bio: user.bio ?? null,
    serviceCategories: user.serviceCategories || [],
    experienceYears: user.experienceYears ?? null,
    isAvailable: user.isAvailable !== false,
    rating: stats.rating ?? null,
    reviewCount: stats.reviewCount ?? 0,
    completedJobs: stats.completedJobs ?? 0,
  };
}
