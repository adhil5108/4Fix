import {
  completeExternalJob as completeExternalJobService,
  createExternalJob as createExternalJobService,
  deleteExternalJob as deleteExternalJobService,
  getExternalJob as getExternalJobService,
  markArrived as markArrivedService,
  markOnTheWay as markOnTheWayService,
  startExternalJob as startExternalJobService,
  updateExternalJob as updateExternalJobService,
} from '../services/externalJob.service.js';

export async function createExternalJob(req, res) {
  const result = await createExternalJobService(req.user, req.body);

  res.status(201).json(result);
}

export async function getExternalJob(req, res) {
  const result = await getExternalJobService(req.user, req.params.jobId);

  res.status(200).json(result);
}

export async function updateExternalJob(req, res) {
  const result = await updateExternalJobService(req.user, req.params.jobId, req.body);

  res.status(200).json(result);
}

export async function deleteExternalJob(req, res) {
  const result = await deleteExternalJobService(req.user, req.params.jobId);

  res.status(200).json(result);
}

export async function markOnTheWay(req, res) {
  const result = await markOnTheWayService(req.user, req.params.jobId);

  res.status(200).json(result);
}

export async function markArrived(req, res) {
  const result = await markArrivedService(req.user, req.params.jobId);

  res.status(200).json(result);
}

export async function startExternalJob(req, res) {
  const result = await startExternalJobService(req.user, req.params.jobId);

  res.status(200).json(result);
}

export async function completeExternalJob(req, res) {
  const result = await completeExternalJobService(req.user, req.params.jobId);

  res.status(200).json(result);
}
