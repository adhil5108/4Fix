import { Router } from 'express';
import {
  login,
  me,
  resendProviderOtp,
  signupProvider,
  verifyProviderOtp,
} from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.post('/login', asyncHandler(login));
router.post('/provider/signup', asyncHandler(signupProvider));
router.post('/provider/verify-otp', asyncHandler(verifyProviderOtp));
router.post('/provider/resend-otp', asyncHandler(resendProviderOtp));
router.get('/me', asyncHandler(authenticate), asyncHandler(me));

export default router;
