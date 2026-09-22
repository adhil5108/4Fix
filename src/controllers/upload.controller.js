import { uploadAudioAsset, uploadImageAsset } from '../services/upload.service.js';

export async function uploadImage(req, res) {
  const result = await uploadImageAsset(req.file, req.user);

  res.status(201).json(result);
}

export async function uploadAudio(req, res) {
  const result = await uploadAudioAsset(req.file, req.user);

  res.status(201).json(result);
}
