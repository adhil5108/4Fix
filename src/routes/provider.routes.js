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

// All three routes below are read-only. /requests is open discovery data already
// visible to every provider (and to admin via the admin console); /requests/:id is
// the same discovery-tier data or nothing; /jobs filters by the caller's own id, so
// ADMIN (added for the "Provider View" area switcher) always sees an empty job list —
// never another provider's jobs. No provider write access is granted here.
router.use(
  asyncHandler(authenticate),
  authorizeRoles(USER_ROLES.PROVIDER, USER_ROLES.ADMIN),
);

router.get('/requests', asyncHandler(listProviderRequests));
router.get('/requests/:requestId', asyncHandler(getProviderRequest));
router.get('/jobs', asyncHandler(listProviderJobs));

export default router;
