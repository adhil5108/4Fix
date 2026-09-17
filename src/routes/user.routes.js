import { Router } from 'express';
import { updateMe } from '../controllers/user.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.patch('/me', asyncHandler(authenticate), asyncHandler(updateMe));

export default router;
