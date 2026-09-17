import { Router } from 'express';
import { acceptQuote, rejectQuote } from '../controllers/quote.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorizeRoles } from '../middleware/authorizeRoles.js';
import { USER_ROLES } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(asyncHandler(authenticate), authorizeRoles(USER_ROLES.CUSTOMER));

router.post('/:quoteId/accept', asyncHandler(acceptQuote));
router.post('/:quoteId/reject', asyncHandler(rejectQuote));

export default router;
