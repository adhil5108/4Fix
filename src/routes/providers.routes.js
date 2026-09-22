import { Router } from 'express';
import { getPublicProvider } from '../controllers/provider.controller.js';
import { listProviderReviews } from '../controllers/review.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Public, customer-safe provider profiles (distinct from the provider's own /api/provider area).
const router = Router();

router.get('/:providerId', asyncHandler(getPublicProvider));
router.get('/:providerId/reviews', asyncHandler(listProviderReviews));

export default router;
