import { Router } from 'express';
import { listCategories, listCategoryServices } from '../controllers/category.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Public, customer-facing: active categories only (admin manages all of them under
// /api/admin/categories).
router.get('/', asyncHandler(listCategories));
router.get('/:categoryId/services', asyncHandler(listCategoryServices));

export default router;
