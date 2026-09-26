import { Router } from 'express';
import {
  acceptRequest,
  cancelRequest,
  completeRequest,
  createRequest,
  getRequest,
  startRequest,
} from '../controllers/request.controller.js';
import { authenticate, authenticateRequestOwner } from '../middleware/authenticate.js';
import { authorizeRoles } from '../middleware/authorizeRoles.js';
import { anonymousRequestLimit } from '../middleware/rateLimit.js';
import { USER_ROLES } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
const provider = [asyncHandler(authenticate), authorizeRoles(USER_ROLES.PROVIDER)];

// Customers have no accounts: anyone may create a request (rate-limited), and the
// response carries the one-time access token that owns it.
router.post('/', anonymousRequestLimit, asyncHandler(createRequest));

// The customer's own request, authorized by its access token (X-Request-Token).
router.get('/:requestId', asyncHandler(authenticateRequestOwner), asyncHandler(getRequest));
router.post('/:requestId/cancel', asyncHandler(authenticateRequestOwner), asyncHandler(cancelRequest));

// Provider job actions. Accept claims an open request atomically so exactly one
// provider wins; start/complete are the only other steps.
router.post('/:requestId/accept', ...provider, asyncHandler(acceptRequest));
router.post('/:requestId/start', ...provider, asyncHandler(startRequest));
router.post('/:requestId/complete', ...provider, asyncHandler(completeRequest));

export default router;
