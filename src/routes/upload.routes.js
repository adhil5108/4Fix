import { Router } from 'express';
import { uploadImage } from '../controllers/upload.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { imageUploadMiddleware } from '../middleware/imageUpload.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.post('/image', asyncHandler(authenticate), imageUploadMiddleware, asyncHandler(uploadImage));

export default router;
