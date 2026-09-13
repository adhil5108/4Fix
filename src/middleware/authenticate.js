import User from '../models/User.js';
import { verifyAccessToken } from '../services/token.service.js';
import { ApiError } from '../utils/ApiError.js';

export async function authenticate(req, _res, next) {
  try {
    const authorization = req.get('Authorization');

    if (!authorization?.startsWith('Bearer ')) {
      throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED');
    }

    const token = authorization.slice('Bearer '.length).trim();
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);

    if (!user || !user.isActive) {
      throw new ApiError(401, 'Invalid authentication token', 'INVALID_TOKEN');
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}
