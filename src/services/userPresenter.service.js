export function toSafeUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    phoneVerifiedAt: user.phoneVerifiedAt,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
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
