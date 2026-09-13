import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

export function createAccessToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      username: user.username,
    },
    env.jwtAccessSecret,
    {
      subject: user.id,
      expiresIn: env.jwtAccessExpiresIn,
    },
  );
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.jwtAccessSecret);
  } catch (_error) {
    throw new ApiError(401, 'Invalid authentication token', 'INVALID_TOKEN');
  }
}
