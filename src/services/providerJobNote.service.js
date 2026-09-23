import ExternalJob from '../models/ExternalJob.js';
import ProviderJobNote, { NOTE_JOB_TYPES } from '../models/ProviderJobNote.js';
import { ApiError } from '../utils/ApiError.js';
import { isSameId, parseObjectId } from '../utils/objectId.js';
import { requiredText } from '../utils/text.js';
import { findBookingOrFail } from './booking.service.js';
import { toProviderJobNote } from './providerJobNotePresenter.service.js';

const MAX_NOTE_LENGTH = 2000;

// Provider-only and strictly the assigned/owning provider. For a BOOKING this mirrors
// the direct isSameId(booking.providerId, ...) check used for tracking transitions in
// booking.service.js (not the shared findBookingForUser, which also lets the booking's
// customer and admin through). For an EXTERNAL_JOB, "not found" already means "not
// yours" (see externalJob.service.js), so there is no separate 403 case there.
async function assertJobOwnership(provider, jobType, jobId) {
  if (jobType === NOTE_JOB_TYPES.EXTERNAL_JOB) {
    const id = parseObjectId(jobId, 'jobId');
    const job = await ExternalJob.findById(id);

    if (!job || !isSameId(job.providerId, provider.id)) {
      throw new ApiError(404, 'Job not found', 'JOB_NOT_FOUND');
    }

    return job;
  }

  const booking = await findBookingOrFail(jobId);

  if (!isSameId(booking.providerId, provider.id)) {
    throw new ApiError(403, 'Access denied', 'FORBIDDEN');
  }

  return booking;
}

async function findOwnNoteOrFail(provider, jobType, jobId, noteId) {
  const id = parseObjectId(noteId, 'noteId');
  const note = await ProviderJobNote.findById(id);

  if (
    !note ||
    note.jobType !== jobType ||
    !isSameId(note.jobId, jobId) ||
    !isSameId(note.providerId, provider.id)
  ) {
    throw new ApiError(404, 'Note not found', 'NOTE_NOT_FOUND');
  }

  return note;
}

export async function listNotes(provider, jobType, jobId) {
  const job = await assertJobOwnership(provider, jobType, jobId);
  const notes = await ProviderJobNote.find({
    jobType,
    jobId: job.id,
    providerId: provider.id,
  }).sort({ updatedAt: -1 });

  return { notes: notes.map(toProviderJobNote) };
}

export async function createNote(provider, jobType, jobId, input) {
  const content = requiredText(input?.content, 'Note', 1, MAX_NOTE_LENGTH);
  const job = await assertJobOwnership(provider, jobType, jobId);

  const note = await ProviderJobNote.create({
    jobType,
    jobId: job.id,
    providerId: provider.id,
    content,
  });

  return { note: toProviderJobNote(note) };
}

export async function updateNote(provider, jobType, jobId, noteId, input) {
  const content = requiredText(input?.content, 'Note', 1, MAX_NOTE_LENGTH);
  await assertJobOwnership(provider, jobType, jobId);
  const note = await findOwnNoteOrFail(provider, jobType, jobId, noteId);

  note.content = content;
  await note.save();

  return { note: toProviderJobNote(note) };
}

export async function deleteNote(provider, jobType, jobId, noteId) {
  await assertJobOwnership(provider, jobType, jobId);
  const note = await findOwnNoteOrFail(provider, jobType, jobId, noteId);

  await note.deleteOne();

  return { deleted: true };
}
