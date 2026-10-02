import User, { USER_ROLES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { normalizePhoneNumber } from '../utils/normalizePhone.js';
import { validateSignupShopLocation } from '../utils/shopLocation.js';
import { parseProviderCategoryIds } from './category.service.js';
import { hashPassword } from './password.service.js';
import { createAccessToken } from './token.service.js';
import { toSafeUser } from './userPresenter.service.js';

function validateSignupInput({ name, phoneNumber, password, confirmPassword } = {}) {
  if (typeof name !== 'string' || name.trim().length < 2) {
    throw new ApiError(400, 'Name must be at least 2 characters', 'VALIDATION_ERROR');
  }

  if (name.trim().length > 120) {
    throw new ApiError(400, 'Name must be 120 characters or fewer', 'VALIDATION_ERROR');
  }

  normalizePhoneNumber(phoneNumber);

  if (typeof password !== 'string' || password.length < 8) {
    throw new ApiError(400, 'Password must be at least 8 characters', 'VALIDATION_ERROR');
  }

  if (password !== confirmPassword) {
    throw new ApiError(400, 'Password confirmation does not match', 'VALIDATION_ERROR');
  }
}

// Only providers have accounts in V1; customers use 4Fix anonymously.
export async function signupProvider(input) {
  validateSignupInput(input);
  const shopLocation = validateSignupShopLocation(input?.shopLocation);
  // "Which categories do you work in?" — at least one, so the request feed has content.
  const categories = await parseProviderCategoryIds(input?.categories ?? [], { required: true });

  const username = normalizePhoneNumber(input.phoneNumber);
  const existingUser = await User.exists({ username });

  if (existingUser) {
    throw new ApiError(409, 'Account already exists', 'ACCOUNT_EXISTS');
  }

  const user = await User.create({
    name: input.name.trim(),
    username,
    passwordHash: await hashPassword(input.password),
    role: USER_ROLES.PROVIDER,
    phoneVerifiedAt: null,
    isActive: true,
    shopLocation,
    categories,
  });
  await user.populate('categories');

  return {
    accessToken: createAccessToken(user),
    user: toSafeUser(user),
  };
}
