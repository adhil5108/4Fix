import { Router } from 'express';
import {
  completeExternalJob,
  createExternalJob,
  deleteExternalJob,
  getExternalJob,
  markArrived,
  markOnTheWay,
  startExternalJob,
  updateExternalJob,
} from '../controllers/externalJob.controller.js';
import {
  createNote,
  deleteNote,
  listNotes,
  updateNote,
} from '../controllers/externalJobNote.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorizeRoles } from '../middleware/authorizeRoles.js';
import { USER_ROLES } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Provider-owned jobs recorded outside 4Fix — provider-only end to end. Unlike bookings,
// admin gets no direct read/write access here at all; admin's existing "always empty"
// preview behavior for /api/provider/jobs (see request.service.js) covers external jobs
// automatically since they're filtered by the caller's own id there too.
router.use(asyncHandler(authenticate), authorizeRoles(USER_ROLES.PROVIDER));

router.post('/', asyncHandler(createExternalJob));
router.get('/:jobId', asyncHandler(getExternalJob));
router.patch('/:jobId', asyncHandler(updateExternalJob));
router.delete('/:jobId', asyncHandler(deleteExternalJob));

router.post('/:jobId/on-the-way', asyncHandler(markOnTheWay));
router.post('/:jobId/arrived', asyncHandler(markArrived));
router.post('/:jobId/start', asyncHandler(startExternalJob));
router.post('/:jobId/complete', asyncHandler(completeExternalJob));

router.get('/:jobId/notes', asyncHandler(listNotes));
router.post('/:jobId/notes', asyncHandler(createNote));
router.patch('/:jobId/notes/:noteId', asyncHandler(updateNote));
router.delete('/:jobId/notes/:noteId', asyncHandler(deleteNote));

export default router;
