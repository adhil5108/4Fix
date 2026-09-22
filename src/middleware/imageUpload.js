import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function imageFileFilter(_req, file, callback) {
  if (!file.mimetype?.startsWith('image/')) {
    callback(new ApiError(400, 'Only image files are allowed', 'INVALID_FILE_TYPE'));
    return;
  }

  callback(null, true);
}

const parseImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter: imageFileFilter,
}).single('image');

// Wraps multer so its errors (size limit, unexpected field, bad type) surface as
// ApiError, consistent with the rest of the API's error format.
export function imageUploadMiddleware(req, res, next) {
  parseImage(req, res, (error) => {
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
        next(new ApiError(413, 'Image must be 5MB or smaller', 'FILE_TOO_LARGE'));
        return;
      }

      if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        next(
          new ApiError(
            400,
            `Unexpected field "${error.field}"; expected "image"`,
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
