import { Router } from 'express';
import {
  login,
  me,
  signupProvider,
} from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Providers and admins only — customers use 4Fix without an account.
router.post('/login', asyncHandler(login));
router.post('/provider/signup', asyncHandler(signupProvider));
router.get('/me', asyncHandler(authenticate), asyncHandler(me));

export default router;
