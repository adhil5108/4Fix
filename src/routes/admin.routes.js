import { Router } from 'express';
import {
  createService,
  deleteService,
  getBooking,
  getCustomer,
  getDashboard,
  getProvider,
  getRequest,
  getReview,
  getService,
  listBookings,
  listCustomers,
  listProviders,
  listRequests,
  listReviews,
  listServices,
  updateProviderStatus,
  updateService,
} from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorizeRoles } from '../middleware/authorizeRoles.js';
import { USER_ROLES } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Every /api/admin/* route requires an authenticated ADMIN — the same middleware
// used everywhere else in the API, not a parallel auth mechanism.
router.use(asyncHandler(authenticate), authorizeRoles(USER_ROLES.ADMIN));

router.get('/dashboard', asyncHandler(getDashboard));

router.get('/services', asyncHandler(listServices));
router.post('/services', asyncHandler(createService));
router.get('/services/:serviceId', asyncHandler(getService));
router.patch('/services/:serviceId', asyncHandler(updateService));
router.delete('/services/:serviceId', asyncHandler(deleteService));

router.get('/providers', asyncHandler(listProviders));
router.get('/providers/:providerId', asyncHandler(getProvider));
router.patch('/providers/:providerId/status', asyncHandler(updateProviderStatus));

router.get('/customers', asyncHandler(listCustomers));
router.get('/customers/:customerId', asyncHandler(getCustomer));

router.get('/requests', asyncHandler(listRequests));
router.get('/requests/:requestId', asyncHandler(getRequest));

router.get('/bookings', asyncHandler(listBookings));
router.get('/bookings/:bookingId', asyncHandler(getBooking));

router.get('/reviews', asyncHandler(listReviews));
router.get('/reviews/:reviewId', asyncHandler(getReview));

export default router;
