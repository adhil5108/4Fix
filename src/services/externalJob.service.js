import ExternalJob, { EXTERNAL_JOB_STATUSES } from '../models/ExternalJob.js';
import { ApiError } from '../utils/ApiError.js';
import { normalizeTimeOfDay, parseDateOnly } from '../utils/dateTime.js';
import { assertExternalJobTransition } from '../utils/externalJobStateMachine.js';
import { isSameId, parseObjectId } from '../utils/objectId.js';
import { optionalText, requiredText } from '../utils/text.js';
import { toExternalJob, toExternalJobSummary } from './externalJobPresenter.service.js';

// Same shape as ServiceRequest's own address validation (request.service.js), kept as a
// local copy since the two features are otherwise unrelated.
function validateAddress(address) {
  if (!address || typeof address !== 'object' || Array.isArray(address)) {
    throw new ApiError(400, 'Address is required', 'VALIDATION_ERROR');
  }

  const pincode = typeof address.pincode === 'string' ? address.pincode.trim() : '';

  if (!/^\d{6}$/.test(pincode)) {
    throw new ApiError(400, 'Pincode must be 6 digits', 'VALIDATION_ERROR');
  }

  return {
    label:
      address.label === undefined || address.label === null || address.label === ''
        ? 'Home'
        : requiredText(address.label, 'Address label', 1, 40),
    addressLine: requiredText(address.addressLine, 'Address line', 5, 240),
    city: requiredText(address.city, 'City', 2, 80),
    state: requiredText(address.state, 'State', 2, 80),
    pincode,
  };
}

function validateAttachments(attachments) {
  if (attachments === undefined || attachments === null) {
    return [];
  }

  if (!Array.isArray(attachments)) {
    throw new ApiError(400, 'Attachments must be an array', 'VALIDATION_ERROR');
  }

  if (attachments.length > 10) {
    throw new ApiError(400, 'A job supports at most 10 attachments', 'VALIDATION_ERROR');
  }

  return attachments.map((attachment) => requiredText(attachment, 'Each attachment', 1, 500));
}

// Optional and never required to be in the future — providers record work that already
// happened just as often as work still to come.
function parseOptionalScheduledDate(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return parseDateOnly(value, 'Scheduled date');
}

function parseOptionalScheduledTime(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return normalizeTimeOfDay(value, 'Scheduled time');
}

function buildFields(input) {
  return {
    customerName: requiredText(input?.customerName, 'Customer name', 1, 120),
    customerPhone: optionalText(input?.customerPhone, 'Customer phone', 20),
    serviceLabel: requiredText(input?.serviceLabel, 'Service / job type', 1, 120),
    description: requiredText(input?.description, 'Description', 1, 2000),
    attachments: validateAttachments(input?.attachments),
    address: validateAddress(input?.address),
    scheduledDate: parseOptionalScheduledDate(input?.scheduledDate),
    scheduledTime: parseOptionalScheduledTime(input?.scheduledTime),
  };
}

// "Not found" covers both a missing job and one owned by someone else — an external job
// is a private record, so its existence is never confirmed to a non-owner.
export async function findOwnJobOrFail(provider, jobId) {
  const id = parseObjectId(jobId, 'jobId');
  const job = await ExternalJob.findById(id);

  if (!job || !isSameId(job.providerId, provider.id)) {
    throw new ApiError(404, 'Job not found', 'JOB_NOT_FOUND');
  }

  return job;
}

export async function createExternalJob(provider, input) {
  const fields = buildFields(input);

  const job = await ExternalJob.create({
    providerId: provider.id,
    ...fields,
    status: EXTERNAL_JOB_STATUSES.SCHEDULED,
  });

  return { job: toExternalJob(job) };
}

export async function getExternalJob(provider, jobId) {
  const job = await findOwnJobOrFail(provider, jobId);

  return { job: toExternalJob(job) };
}

export async function updateExternalJob(provider, jobId, input) {
  const job = await findOwnJobOrFail(provider, jobId);
  const fields = buildFields(input);

  Object.assign(job, fields);
  await job.save();

  return { job: toExternalJob(job) };
}

export async function deleteExternalJob(provider, jobId) {
  const job = await findOwnJobOrFail(provider, jobId);

  await job.deleteOne();

  return { deleted: true };
}

async function applyTransition(provider, jobId, targetStatus, extraFields) {
  const job = await findOwnJobOrFail(provider, jobId);

  assertExternalJobTransition(job.status, targetStatus);
  Object.assign(job, { status: targetStatus, ...extraFields });
  await job.save();

  return { job: toExternalJob(job) };
}

export function markOnTheWay(provider, jobId) {
  return applyTransition(provider, jobId, EXTERNAL_JOB_STATUSES.ON_THE_WAY, { onTheWayAt: new Date() });
}

export function markArrived(provider, jobId) {
  return applyTransition(provider, jobId, EXTERNAL_JOB_STATUSES.ARRIVED, { arrivedAt: new Date() });
}

export function startExternalJob(provider, jobId) {
  return applyTransition(provider, jobId, EXTERNAL_JOB_STATUSES.IN_PROGRESS, { startedAt: new Date() });
}

export function completeExternalJob(provider, jobId) {
  return applyTransition(provider, jobId, EXTERNAL_JOB_STATUSES.COMPLETED, { completedAt: new Date() });
}

// Merged into the provider's "My Jobs" list (request.service.js's listProviderJobs).
export async function listExternalJobsForProvider(providerId) {
  const jobs = await ExternalJob.find({ providerId }).sort({ updatedAt: -1 });

  return jobs.map(toExternalJobSummary);
}
