import { EXTERNAL_JOB_STATUSES } from '../models/ExternalJob.js';
import { ApiError } from './ApiError.js';

const ALLOWED_TRANSITIONS = {
  [EXTERNAL_JOB_STATUSES.SCHEDULED]: [
    EXTERNAL_JOB_STATUSES.ON_THE_WAY,
    EXTERNAL_JOB_STATUSES.ARRIVED,
    EXTERNAL_JOB_STATUSES.IN_PROGRESS,
  ],
  [EXTERNAL_JOB_STATUSES.ON_THE_WAY]: [EXTERNAL_JOB_STATUSES.ARRIVED, EXTERNAL_JOB_STATUSES.IN_PROGRESS],
  [EXTERNAL_JOB_STATUSES.ARRIVED]: [EXTERNAL_JOB_STATUSES.IN_PROGRESS],
  [EXTERNAL_JOB_STATUSES.IN_PROGRESS]: [EXTERNAL_JOB_STATUSES.COMPLETED],
  [EXTERNAL_JOB_STATUSES.COMPLETED]: [],
};

export function canExternalJobTransition(fromStatus, toStatus) {
  return (ALLOWED_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

export function assertExternalJobTransition(fromStatus, toStatus) {
  if (!canExternalJobTransition(fromStatus, toStatus)) {
    throw new ApiError(409, `A ${fromStatus} job cannot change to ${toStatus}`, 'INVALID_STATE_TRANSITION');
  }
}
