import cloudinary from '../config/cloudinary.js';
import { ApiError } from '../utils/ApiError.js';

const UPLOAD_FOLDER = '4fix';
const VOICE_NOTE_FOLDER = '4fix/voice-notes';

function toDataUri(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

function toImageResult(asset) {
  return {
    url: asset.secure_url || asset.url,
    publicId: asset.public_id,
    width: asset.width,
    height: asset.height,
    format: asset.format,
  };
}

// `user` is the authenticated uploader (req.user); never trust a client-supplied id.
export async function uploadImageAsset(file, user) {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new ApiError(400, 'An image file is required', 'IMAGE_REQUIRED');
  }

  let asset;

  try {
    asset = await cloudinary.uploader.upload(toDataUri(file), {
      folder: UPLOAD_FOLDER,
      resource_type: 'image',
      context: { uploaded_by: String(user.id) },
    });
  } catch (error) {
    // Cloudinary error details (never the configured secret) are logged server-side only.
    console.error('Cloudinary upload failed:', error?.message || error);
    throw new ApiError(502, 'Failed to upload image. Please try again.', 'UPLOAD_FAILED');
  }

  return {
    image: toImageResult(asset),
  };
}

function toAudioResult(asset) {
  return {
    url: asset.secure_url || asset.url,
    publicId: asset.public_id,
    format: asset.format,
    durationSeconds: typeof asset.duration === 'number' ? asset.duration : null,
  };
}

// Cloudinary has no dedicated "audio" resource type; non-image/raw binary assets
// (including audio) upload as `resource_type: 'video'`.
export async function uploadAudioAsset(file, user) {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new ApiError(400, 'An audio file is required', 'AUDIO_REQUIRED');
  }

  let asset;

  try {
    asset = await cloudinary.uploader.upload(toDataUri(file), {
      folder: VOICE_NOTE_FOLDER,
      resource_type: 'video',
      context: { uploaded_by: String(user.id) },
    });
  } catch (error) {
    console.error('Cloudinary upload failed:', error?.message || error);
    throw new ApiError(502, 'Failed to upload audio. Please try again.', 'UPLOAD_FAILED');
  }

  return {
    audio: toAudioResult(asset),
  };
}
