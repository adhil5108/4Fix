import { Router } from 'express';
import {
  cancelRequest,
  completeRequest,
  createRequest,
  getRequest,
  listRequests,
  scheduleRequest,
  startRequest,
} from '../controllers/request.controller.js';
import { createQuote, listRequestQuotes } from '../controllers/quote.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorizeRoles } from '../middleware/authorizeRoles.js';
import { USER_ROLES } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(asyncHandler(authenticate));

router.post('/', authorizeRoles(USER_ROLES.CUSTOMER), asyncHandler(createRequest));
router.get('/', authorizeRoles(USER_ROLES.CUSTOMER), asyncHandler(listRequests));
router.get('/:requestId', authorizeRoles(USER_ROLES.CUSTOMER), asyncHandler(getRequest));
router.post(
  '/:requestId/cancel',
  authorizeRoles(USER_ROLES.CUSTOMER),
  asyncHandler(cancelRequest),
);

router.post(
  '/:requestId/quotes',
  authorizeRoles(USER_ROLES.PROVIDER),
  asyncHandler(createQuote),
);
router.get(
  '/:requestId/quotes',
  authorizeRoles(USER_ROLES.CUSTOMER, USER_ROLES.PROVIDER),
  asyncHandler(listRequestQuotes),
);

router.post(
  '/:requestId/schedule',
  authorizeRoles(USER_ROLES.PROVIDER),
  asyncHandler(scheduleRequest),
);
router.post(
  '/:requestId/start',
  authorizeRoles(USER_ROLES.PROVIDER),
  asyncHandler(startRequest),
);
router.post(
  '/:requestId/complete',
  authorizeRoles(USER_ROLES.PROVIDER),
  asyncHandler(completeRequest),
);

export default router;
