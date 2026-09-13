import User, { USER_ROLES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { normalizePhoneNumber } from '../utils/normalizePhone.js';
import { hashPassword } from './password.service.js';
import { createAccessToken } from './token.service.js';
import { toSafeUser } from './userPresenter.service.js';

function validateSignupInput({ name, phoneNumber, password, confirmPassword }) {
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

async function signupWithRole(input, role) {
  validateSignupInput(input);

  const username = normalizePhoneNumber(input.phoneNumber);
  const existingUser = await User.exists({ username });

  if (existingUser) {
    throw new ApiError(409, 'Account already exists', 'ACCOUNT_EXISTS');
  }

  const user = await User.create({
    name: input.name.trim(),
    username,
    passwordHash: await hashPassword(input.password),
    role,
    phoneVerifiedAt: null,
    isActive: true,
  });

  return {
    accessToken: createAccessToken(user),
    user: toSafeUser(user),
  };
}

export function signupCustomer(input) {
  return signupWithRole(input, USER_ROLES.CUSTOMER);
}

export function signupProvider(input) {
  return signupWithRole(input, USER_ROLES.PROVIDER);
}
