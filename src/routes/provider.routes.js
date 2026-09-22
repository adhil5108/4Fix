import { Router } from 'express';
import {
  getProviderRequest,
  listProviderJobs,
  listProviderRequests,
} from '../controllers/provider.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorizeRoles } from '../middleware/authorizeRoles.js';
import { USER_ROLES } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(asyncHandler(authenticate), authorizeRoles(USER_ROLES.PROVIDER));

router.get('/requests', asyncHandler(listProviderRequests));
router.get('/requests/:requestId', asyncHandler(getProviderRequest));
router.get('/jobs', asyncHandler(listProviderJobs));

export default router;
