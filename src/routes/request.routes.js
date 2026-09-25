import { Router } from 'express';
import {
  acceptRequest,
  cancelRequest,
  completeRequest,
  createRequest,
  getRequest,
  listRequests,
  scheduleRequest,
  startRequest,
} from '../controllers/request.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorizeRoles } from '../middleware/authorizeRoles.js';
import { USER_ROLES } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(asyncHandler(authenticate));

router.post('/', authorizeRoles(USER_ROLES.CUSTOMER), asyncHandler(createRequest));
// ADMIN read-only for the "Customer View" area switcher: listCustomerRequests filters
// by the caller's own id, so an admin (who owns none) always sees an empty list —
// never another customer's requests. No admin write access is granted here.
router.get(
  '/',
  authorizeRoles(USER_ROLES.CUSTOMER, USER_ROLES.ADMIN),
  asyncHandler(listRequests),
);
router.get('/:requestId', authorizeRoles(USER_ROLES.CUSTOMER), asyncHandler(getRequest));
router.post(
  '/:requestId/cancel',
  authorizeRoles(USER_ROLES.CUSTOMER),
  asyncHandler(cancelRequest),
);
// Any active PROVIDER may try to claim an open request; the service makes the claim
// atomic so exactly one provider wins.
router.post(
  '/:requestId/accept',
  authorizeRoles(USER_ROLES.PROVIDER),
  asyncHandler(acceptRequest),
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
