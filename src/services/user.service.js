import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { toSafeUser } from './userPresenter.service.js';

export async function updateCurrentUser(user, input) {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';

  if (name.length < 2) {
    throw new ApiError(400, 'Name must be at least 2 characters', 'VALIDATION_ERROR');
  }

  if (name.length > 120) {
    throw new ApiError(400, 'Name must be 120 characters or fewer', 'VALIDATION_ERROR');
  }

  const updatedUser = await User.findByIdAndUpdate(
    user.id,
    { $set: { name } },
    { returnDocument: 'after' },
  );

  if (!updatedUser) {
    throw new ApiError(404, 'User not found', 'USER_NOT_FOUND');
  }

  return {
    user: toSafeUser(updatedUser),
  };
}
