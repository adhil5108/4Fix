import { Router } from 'express';
import { getBooking, listBookings } from '../controllers/booking.controller.js';
import {
  getConversation,
  getUnreadSummary,
  listMessages,
  markMessagesRead,
  openConversation,
  sendMessage,
} from '../controllers/chat.controller.js';
import {
  createNote,
  deleteNote,
  listNotes,
  updateNote,
} from '../controllers/providerJobNote.controller.js';
import { createReview, getReview } from '../controllers/review.controller.js';
import { authenticateAny } from '../middleware/authenticate.js';
import { authorizeRoles } from '../middleware/authorizeRoles.js';
import { USER_ROLES } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const { CUSTOMER, PROVIDER, ADMIN } = USER_ROLES;
const router = Router();

// Providers/admins authenticate with a JWT; the (anonymous) customer with the access
// token of the request this booking came from. Ownership is enforced inside the
// services: a provider reaches only their own jobs, a customer only their request's
// job, and ADMIN reads platform-wide (but gets an empty list from GET /).
router.use(asyncHandler(authenticateAny));

router.get('/', authorizeRoles(CUSTOMER, PROVIDER, ADMIN), asyncHandler(listBookings));
// Unread chat counts for the caller's own conversations. Participants only: admin reads
// chats but is never a recipient. Must precede '/:bookingId'.
router.get('/unread', authorizeRoles(CUSTOMER, PROVIDER), asyncHandler(getUnreadSummary));
router.get('/:bookingId', authorizeRoles(CUSTOMER, PROVIDER, ADMIN), asyncHandler(getBooking));

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

router.post('/:bookingId/review', authorizeRoles(CUSTOMER), asyncHandler(createReview));
router.get('/:bookingId/review', authorizeRoles(CUSTOMER, PROVIDER, ADMIN), asyncHandler(getReview));

// Private to the assigned provider only — unlike chat, neither the customer
// nor admin can read or write these (ownership re-checked in the service too).
router.get('/:bookingId/notes', authorizeRoles(PROVIDER), asyncHandler(listNotes));
router.post('/:bookingId/notes', authorizeRoles(PROVIDER), asyncHandler(createNote));
router.patch('/:bookingId/notes/:noteId', authorizeRoles(PROVIDER), asyncHandler(updateNote));
router.delete('/:bookingId/notes/:noteId', authorizeRoles(PROVIDER), asyncHandler(deleteNote));

export default router;
