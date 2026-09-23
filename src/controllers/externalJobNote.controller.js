import { NOTE_JOB_TYPES } from '../models/ProviderJobNote.js';
import {
  createNote as createNoteService,
  deleteNote as deleteNoteService,
  listNotes as listNotesService,
  updateNote as updateNoteService,
} from '../services/providerJobNote.service.js';

export async function listNotes(req, res) {
  const result = await listNotesService(req.user, NOTE_JOB_TYPES.EXTERNAL_JOB, req.params.jobId);

  res.status(200).json(result);
}

export async function createNote(req, res) {
  const result = await createNoteService(req.user, NOTE_JOB_TYPES.EXTERNAL_JOB, req.params.jobId, req.body);

  res.status(201).json(result);
}

export async function updateNote(req, res) {
  const result = await updateNoteService(
    req.user,
    NOTE_JOB_TYPES.EXTERNAL_JOB,
    req.params.jobId,
    req.params.noteId,
    req.body,
  );

  res.status(200).json(result);
}

export async function deleteNote(req, res) {
  const result = await deleteNoteService(
    req.user,
    NOTE_JOB_TYPES.EXTERNAL_JOB,
    req.params.jobId,
    req.params.noteId,
  );

  res.status(200).json(result);
}
