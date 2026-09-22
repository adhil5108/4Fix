import { Router } from 'express';
import {
  getService,
  listServices,
  searchServices,
} from '../controllers/service.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(listServices));
// Declared before /:serviceId so "search" is never parsed as an id.
router.get('/search', asyncHandler(searchServices));
router.get('/:serviceId', asyncHandler(getService));

export default router;
