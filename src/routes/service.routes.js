import { Router } from 'express';
import { getService, listServices } from '../controllers/service.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(listServices));
router.get('/:serviceId', asyncHandler(getService));

export default router;
