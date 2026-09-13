import { ApiError } from '../utils/ApiError.js';

export function authorizeRoles(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      next(new ApiError(401, 'Authentication required', 'AUTH_REQUIRED'));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(new ApiError(403, 'Access denied', 'FORBIDDEN'));
      return;
    }

    next();
  };
}
