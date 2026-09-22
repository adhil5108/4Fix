import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB — generous for a ~2 minute recording

// Allowlist rather than a blanket `audio/*` check: covers what MediaRecorder produces
// across Chrome/Firefox (webm/opus) and Safari (mp4/aac), plus common upload formats.
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/x-m4a',
  'audio/m4a',
]);

function audioFileFilter(_req, file, callback) {
  if (!ALLOWED_AUDIO_TYPES.has(file.mimetype)) {
    callback(new ApiError(400, 'Only audio files are allowed', 'INVALID_FILE_TYPE'));
    return;
  }

  callback(null, true);
}

const parseAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter: audioFileFilter,
}).single('audio');

// Wraps multer so its errors (size limit, unexpected field, bad type) surface as
// ApiError, consistent with the rest of the API's error format.
export function audioUploadMiddleware(req, res, next) {
  parseAudio(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof ApiError) {
      next(error);
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(new ApiError(413, 'Audio must be 10MB or smaller', 'FILE_TOO_LARGE'));
        return;
      }

      if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        next(
          new ApiError(
            400,
            `Unexpected field "${error.field}"; expected "audio"`,
            'INVALID_FILE_FIELD',
          ),
        );
        return;
      }

      next(new ApiError(400, 'Invalid file upload', 'INVALID_UPLOAD'));
      return;
    }

    next(error);
  });
}
