import { Router } from 'express';
import { uploadAudio, uploadImage } from '../controllers/upload.controller.js';
import { optionalAuthenticate } from '../middleware/authenticate.js';
import { audioUploadMiddleware } from '../middleware/audioUpload.js';
import { imageUploadMiddleware } from '../middleware/imageUpload.js';
import { anonymousUploadLimit } from '../middleware/rateLimit.js';
import { USER_ROLES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Customers upload photos/voice before their (anonymous) request exists, so these accept
// unauthenticated callers, rate-limited per IP. Providers/admins upload with their JWT
// (external-job photos, service images) and are not rate-limited.
router.post(
  '/image',
  asyncHandler(optionalAuthenticate),
  anonymousUploadLimit,
  imageUploadMiddleware,
  asyncHandler(uploadImage),
);

// Voice notes belong to customer requests only, so provider/admin accounts are refused.
function customersOnly(req, _res, next) {
  if (req.user && req.user.role !== USER_ROLES.CUSTOMER) {
    next(new ApiError(403, 'Access denied', 'FORBIDDEN'));
    return;
  }

  next();
}

router.post(
  '/audio',
  asyncHandler(optionalAuthenticate),
  customersOnly,
  anonymousUploadLimit,
  audioUploadMiddleware,
  asyncHandler(uploadAudio),
);

export default router;
