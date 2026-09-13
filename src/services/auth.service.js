import User, { USER_ROLES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { normalizeUsername } from '../utils/normalizeUsername.js';
import { verifyPassword } from './password.service.js';
import { createAccessToken } from './token.service.js';
import { toSafeUser } from './userPresenter.service.js';

const AUTHENTICATED_ROLES = [USER_ROLES.PROVIDER, USER_ROLES.ADMIN];

export function getCurrentUser(user) {
  return {
    user: toSafeUser(user),
  };
}

export async function loginUser(input) {
  const username = normalizeUsername(input?.username);

  if (typeof input?.password !== 'string' || input.password.length === 0) {
    throw new ApiError(400, 'Password is required', 'VALIDATION_ERROR');
  }

  const user = await User.findOne({ username }).select('+passwordHash');

  if (!user || !AUTHENTICATED_ROLES.includes(user.role)) {
    throw new ApiError(401, 'Invalid username or password', 'INVALID_CREDENTIALS');
  }

  if (!user.isActive) {
    throw new ApiError(403, 'User account is inactive', 'USER_INACTIVE');
  }

  const passwordMatches = await verifyPassword(input.password, user.passwordHash);

  if (!passwordMatches) {
    throw new ApiError(401, 'Invalid username or password', 'INVALID_CREDENTIALS');
  }

  return {
    accessToken: createAccessToken(user),
    user: toSafeUser(user),
  };
}
