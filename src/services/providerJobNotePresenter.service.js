import { toIdString } from '../utils/objectId.js';

export function toProviderJobNote(note) {
  return {
    id: note.id,
    jobId: toIdString(note.jobId),
    content: note.content,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}
