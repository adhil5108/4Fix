import ServiceRequest from '../models/ServiceRequest.js';
import User, { USER_ROLES } from '../models/User.js';
import { verifyAccessToken } from '../services/token.service.js';
import { hashAccessToken } from '../utils/accessToken.js';
import { ApiError } from '../utils/ApiError.js';

export const REQUEST_TOKEN_HEADER = 'X-Request-Token';

// Only providers and admins have accounts in V1. Tokens issued to legacy customer
// accounts are refused so the only customer identity is a request access token.
export async function resolveUserFromJwt(token) {
  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub);

  if (!user || !user.isActive || user.role === USER_ROLES.CUSTOMER) {
    throw new ApiError(401, 'Invalid authentication token', 'INVALID_TOKEN');
  }

  return user;
}

// An anonymous customer principal scoped to exactly one request. It carries no user id:
// services authorize customers by `requestId`, never by account.
export async function resolveRequestOwner(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
    throw new ApiError(401, 'Invalid request access token', 'INVALID_TOKEN');
  }

  const request = await ServiceRequest.findOne({ accessTokenHash: hashAccessToken(token) }).select('_id');

  if (!request) {
    throw new ApiError(401, 'Invalid request access token', 'INVALID_TOKEN');
  }

  return { id: null, role: USER_ROLES.CUSTOMER, requestId: request.id, isAnonymous: true };
}

function bearerToken(req) {
  const authorization = req.get('Authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : null;
}

// Provider/admin routes: a valid JWT is required.
export async function authenticate(req, _res, next) {
  try {
    const token = bearerToken(req);

    if (!token) {
      throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED');
    }

    req.user = await resolveUserFromJwt(token);
    next();
  } catch (error) {
    next(error.statusCode ? error : new ApiError(401, 'Invalid authentication token', 'INVALID_TOKEN'));
  }
}

// Customer-only routes: the request access token is required.
export async function authenticateRequestOwner(req, _res, next) {
  try {
    const token = req.get(REQUEST_TOKEN_HEADER);

    if (!token) {
      throw new ApiError(401, 'Request access token required', 'AUTH_REQUIRED');
    }

    req.user = await resolveRequestOwner(token);
    next();
  } catch (error) {
    next(error);
  }
}

// Routes shared by both sides of a job (booking, chat, review): a provider/admin JWT,
// or else a customer's request access token.
export async function authenticateAny(req, res, next) {
  if (bearerToken(req)) {
    return authenticate(req, res, next);
  }

  if (req.get(REQUEST_TOKEN_HEADER)) {
    return authenticateRequestOwner(req, res, next);
  }

  next(new ApiError(401, 'Authentication required', 'AUTH_REQUIRED'));
}

// Uploads: anonymous customers may upload before their request exists; a JWT, when
// sent, must still be valid so roles can be checked.
export async function optionalAuthenticate(req, res, next) {
  if (bearerToken(req)) {
    return authenticate(req, res, next);
  }

  next();
}
