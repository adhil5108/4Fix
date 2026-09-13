import { Router } from 'express';
import {
  login,
  me,
  signupCustomer,
  signupProvider,
} from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.post('/login', asyncHandler(login));
router.post('/customer/signup', asyncHandler(signupCustomer));
router.post('/provider/signup', asyncHandler(signupProvider));
router.get('/me', asyncHandler(authenticate), asyncHandler(me));

export default router;
