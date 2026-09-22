import User, { USER_ROLES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { optionalText, requiredText, stringList } from '../utils/text.js';
import { toSafeUser } from './userPresenter.service.js';

function parseExperienceYears(value) {
  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0 || value > 60) {
    throw new ApiError(400, 'Experience years must be a whole number from 0 to 60', 'VALIDATION_ERROR');
  }

  return value;
}

function buildUpdate(user, input) {
  const update = {};

  if (input?.name !== undefined) {
    update.name = requiredText(input.name, 'Name', 2, 120);
  }

  // Profile fields only mean something for providers; other roles can just rename.
  if (user.role === USER_ROLES.PROVIDER) {
    if (input?.bio !== undefined) {
      update.bio = optionalText(input.bio, 'Bio', 500);
    }

    if (input?.profileImage !== undefined) {
      update.profileImage = optionalText(input.profileImage, 'Profile image', 500);
    }

    if (input?.serviceCategories !== undefined) {
      update.serviceCategories = [
        ...new Set(
          stringList(input.serviceCategories, 'Service categories', 20, 60).map((category) =>
            category.toUpperCase(),
          ),
        ),
      ];
    }

    if (input?.experienceYears !== undefined) {
      update.experienceYears = parseExperienceYears(input.experienceYears);
    }

    if (input?.isAvailable !== undefined) {
      if (typeof input.isAvailable !== 'boolean') {
        throw new ApiError(400, 'Availability must be true or false', 'VALIDATION_ERROR');
      }

      update.isAvailable = input.isAvailable;
    }
  }

  return update;
}

export async function updateCurrentUser(user, input) {
  const update = buildUpdate(user, input);

  if (Object.keys(update).length === 0) {
    throw new ApiError(400, 'Name must be at least 2 characters', 'VALIDATION_ERROR');
  }

  const updatedUser = await User.findByIdAndUpdate(
    user.id,
    { $set: update },
    { returnDocument: 'after' },
  );

  if (!updatedUser) {
    throw new ApiError(404, 'User not found', 'USER_NOT_FOUND');
  }

  return {
    user: toSafeUser(updatedUser),
  };
}
