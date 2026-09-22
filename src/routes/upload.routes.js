import { Router } from 'express';
import { uploadAudio, uploadImage } from '../controllers/upload.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorizeRoles } from '../middleware/authorizeRoles.js';
import { audioUploadMiddleware } from '../middleware/audioUpload.js';
import { imageUploadMiddleware } from '../middleware/imageUpload.js';
import { USER_ROLES } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.post('/image', asyncHandler(authenticate), imageUploadMiddleware, asyncHandler(uploadImage));

// Only customers record voice notes in V1 (attached to a request they're creating).
router.post(
  '/audio',
  asyncHandler(authenticate),
  authorizeRoles(USER_ROLES.CUSTOMER),
  audioUploadMiddleware,
  asyncHandler(uploadAudio),
);

export default router;
