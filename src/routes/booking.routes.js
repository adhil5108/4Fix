import { Router } from 'express';
import {
  assignBooking,
  getBooking,
  getTracking,
  listBookings,
  markArrived,
  markOnTheWay,
  updateLocation,
} from '../controllers/booking.controller.js';
import {
  getConversation,
  listMessages,
  markMessagesRead,
  openConversation,
  sendMessage,
} from '../controllers/chat.controller.js';
import { getPayment, markPaymentPaid } from '../controllers/payment.controller.js';
import { createReview, getReview } from '../controllers/review.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorizeRoles } from '../middleware/authorizeRoles.js';
import { USER_ROLES } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const { CUSTOMER, PROVIDER, ADMIN } = USER_ROLES;
const router = Router();

router.use(asyncHandler(authenticate));

// Ownership is enforced inside the services from req.user; roles only gate the verb.
// listBookings falls back to { customerId: user.id } for any non-PROVIDER caller, so
// ADMIN (added for the "Customer View" area switcher) always sees an empty list —
// never another customer's or provider's bookings.
router.get('/', authorizeRoles(CUSTOMER, PROVIDER, ADMIN), asyncHandler(listBookings));
router.get('/:bookingId', authorizeRoles(CUSTOMER, PROVIDER, ADMIN), asyncHandler(getBooking));
router.get(
  '/:bookingId/tracking',
  authorizeRoles(CUSTOMER, PROVIDER, ADMIN),
  asyncHandler(getTracking),
);

router.post('/:bookingId/assign', authorizeRoles(PROVIDER), asyncHandler(assignBooking));
router.post('/:bookingId/on-the-way', authorizeRoles(PROVIDER), asyncHandler(markOnTheWay));
router.post('/:bookingId/arrived', authorizeRoles(PROVIDER), asyncHandler(markArrived));
router.patch('/:bookingId/location', authorizeRoles(PROVIDER), asyncHandler(updateLocation));

// Admin can read any conversation platform-wide (ADMIN bypasses ownership inside
// findBookingForUser) but never open/send/mark-read on someone else's behalf — that
// keeps admin read-only with respect to chat, never able to act as a participant.
router.post('/:bookingId/chat', authorizeRoles(CUSTOMER, PROVIDER), asyncHandler(openConversation));
router.get(
  '/:bookingId/chat',
  authorizeRoles(CUSTOMER, PROVIDER, ADMIN),
  asyncHandler(getConversation),
);
router.get(
  '/:bookingId/messages',
  authorizeRoles(CUSTOMER, PROVIDER, ADMIN),
  asyncHandler(listMessages),
);
router.post('/:bookingId/messages', authorizeRoles(CUSTOMER, PROVIDER), asyncHandler(sendMessage));
router.post(
  '/:bookingId/messages/read',
  authorizeRoles(CUSTOMER, PROVIDER),
  asyncHandler(markMessagesRead),
);

router.get(
  '/:bookingId/payment',
  authorizeRoles(CUSTOMER, PROVIDER, ADMIN),
  asyncHandler(getPayment),
);
router.post(
  '/:bookingId/payment/mark-paid',
  authorizeRoles(PROVIDER, ADMIN),
  asyncHandler(markPaymentPaid),
);

router.post('/:bookingId/review', authorizeRoles(CUSTOMER), asyncHandler(createReview));
router.get('/:bookingId/review', authorizeRoles(CUSTOMER, PROVIDER, ADMIN), asyncHandler(getReview));

export default router;
