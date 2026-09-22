import Booking, { BOOKING_STATUSES } from '../models/Booking.js';
import Quote from '../models/Quote.js';
import { OTHER_ISSUE_KEY } from '../models/Service.js';
import ServiceRequest, { REQUEST_STATUSES } from '../models/ServiceRequest.js';
import { ApiError } from '../utils/ApiError.js';
import {
  assertNotPastDate,
  normalizeTimeOfDay,
  parseDateOnly,
} from '../utils/dateTime.js';
import { isSameId, parseObjectId, toIdString } from '../utils/objectId.js';
import {
  assertTransition,
  QUOTABLE_REQUEST_STATUSES,
} from '../utils/requestStateMachine.js';
import { requiredText } from '../utils/text.js';
import { syncBookingWithRequest } from './bookingSync.service.js';
import {
  toCustomerRequest,
  toProviderJob,
  toProviderRequest,
  toProviderRequestSummary,
} from './requestPresenter.service.js';
import { getActiveServiceOrFail } from './service.service.js';

// Exported so the admin request service can reuse the exact same populate shapes
// instead of redefining them.
export const CUSTOMER_POPULATE = [
  { path: 'serviceId' },
  { path: 'selectedProviderId' },
];

export const CUSTOMER_DETAIL_POPULATE = [
  ...CUSTOMER_POPULATE,
  { path: 'acceptedQuoteId', populate: { path: 'providerId' } },
];

const PROVIDER_DETAIL_POPULATE = [{ path: 'serviceId' }, { path: 'customerId' }];

const PROVIDER_JOB_POPULATE = [
  { path: 'serviceId' },
  { path: 'customerId' },
  { path: 'acceptedQuoteId' },
];

function validateAttachments(attachments) {
  if (attachments === undefined || attachments === null) {
    return [];
  }

  if (!Array.isArray(attachments)) {
    throw new ApiError(400, 'Attachments must be an array', 'VALIDATION_ERROR');
  }

  if (attachments.length > 10) {
    throw new ApiError(400, 'A request supports at most 10 attachments', 'VALIDATION_ERROR');
  }

  return attachments.map((attachment) =>
    requiredText(attachment, 'Each attachment', 1, 500),
  );
}

const AUDIO_FORMATS = ['webm', 'ogg', 'mp4', 'm4a', 'mpeg', 'mp3', 'wav', 'aac'];

// Client-derived (url from a prior upload, duration from the recorder timer) — trusted
// the same way photo `attachments` URLs already are. Bounds here are a sanity check,
// not the primary control (that's the upload endpoint's own size/type validation).
function validateVoiceNote(voiceNote) {
  if (voiceNote === undefined || voiceNote === null) {
    return null;
  }

  if (typeof voiceNote !== 'object' || Array.isArray(voiceNote)) {
    throw new ApiError(400, 'Voice note must be an object', 'VALIDATION_ERROR');
  }

  const url = requiredText(voiceNote.url, 'Voice note URL', 1, 500);
  let format = null;

  if (voiceNote.format !== undefined && voiceNote.format !== null && voiceNote.format !== '') {
    format = requiredText(voiceNote.format, 'Voice note format', 1, 40).toLowerCase();

    if (!AUDIO_FORMATS.includes(format)) {
      throw new ApiError(400, 'Unsupported voice note format', 'VALIDATION_ERROR');
    }
  }

  let durationSeconds = null;

  if (voiceNote.durationSeconds !== undefined && voiceNote.durationSeconds !== null) {
    const value = Number(voiceNote.durationSeconds);

    if (!Number.isFinite(value) || value < 0 || value > 600) {
      throw new ApiError(400, 'Voice note duration is invalid', 'VALIDATION_ERROR');
    }

    durationSeconds = value;
  }

  return { url, format, durationSeconds };
}

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

// The issue is optional (V1 clients do not send it). When present it must be one of the
// service's active issues or OTHER; the label always comes from the service, never
// from the client.
function resolveIssue(service, issueKey) {
  if (issueKey === undefined || issueKey === null || issueKey === '') {
    return { issueKey: null, issueLabel: null };
  }

  const key = requiredText(issueKey, 'Issue', 1, 60).toUpperCase();

  if (key === OTHER_ISSUE_KEY) {
    return { issueKey: key, issueLabel: 'Something else' };
  }

  const issue = (service.issues || []).find((item) => item.isActive && item.key === key);

  if (!issue) {
    throw new ApiError(400, 'Issue is not available for this service', 'VALIDATION_ERROR');
  }

  return { issueKey: issue.key, issueLabel: issue.label };
}

export function parseStatusFilter(value, allowedStatuses) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const status = String(value).trim().toUpperCase();

  if (!allowedStatuses.includes(status)) {
    throw new ApiError(
      400,
      `Status must be one of: ${allowedStatuses.join(', ')}`,
      'VALIDATION_ERROR',
    );
  }

  return status;
}

async function findRequestOrFail(requestId) {
  const id = parseObjectId(requestId, 'requestId');
  const request = await ServiceRequest.findById(id);

  if (!request) {
    throw new ApiError(404, 'Service request not found', 'REQUEST_NOT_FOUND');
  }

  return request;
}

export async function findCustomerRequestOrFail(requestId, customer) {
  const request = await findRequestOrFail(requestId);

  if (!isSameId(request.customerId, customer.id)) {
    throw new ApiError(403, 'Access denied', 'FORBIDDEN');
  }

  return request;
}

async function loadCustomerRequest(requestId) {
  return ServiceRequest.findById(requestId).populate(CUSTOMER_DETAIL_POPULATE);
}

export async function createRequest(customer, input) {
  const service = await getActiveServiceOrFail(input?.serviceId);
  const issue = resolveIssue(service, input?.issueKey);
  const description = requiredText(input?.description, 'Description', 5, 2000);
  const attachments = validateAttachments(input?.attachments);
  const voiceNote = validateVoiceNote(input?.voiceNote);
  const address = validateAddress(input?.address);
  const preferredDate = parseDateOnly(input?.preferredDate, 'Preferred date');
  const preferredTime = normalizeTimeOfDay(input?.preferredTime, 'Preferred time');

  assertNotPastDate(preferredDate, 'Preferred date');

  const created = await ServiceRequest.create({
    customerId: customer.id,
    serviceId: service.id,
    issueKey: issue.issueKey,
    issueLabel: issue.issueLabel,
    description,
    attachments,
    voiceNote,
    address,
    preferredDate,
    preferredTime,
    status: REQUEST_STATUSES.PENDING,
    selectedProviderId: null,
    acceptedQuoteId: null,
    scheduledDate: null,
    scheduledTime: null,
  });

  await created.populate(CUSTOMER_POPULATE);

  return {
    request: toCustomerRequest(created),
  };
}

export async function listCustomerRequests(customer, query) {
  const status = parseStatusFilter(query?.status, Object.values(REQUEST_STATUSES));
  const filter = { customerId: customer.id };

  if (status) {
    filter.status = status;
  }

  const requests = await ServiceRequest.find(filter)
    .sort({ createdAt: -1 })
    .populate(CUSTOMER_POPULATE);

  return {
    requests: requests.map((request) => toCustomerRequest(request)),
  };
}

export async function getCustomerRequest(customer, requestId) {
  const request = await findCustomerRequestOrFail(requestId, customer);
  const [detailedRequest, quotesCount, booking] = await Promise.all([
    loadCustomerRequest(request.id),
    Quote.countDocuments({ requestId: request.id }),
    Booking.findOne({ requestId: request.id }),
  ]);

  return {
    request: toCustomerRequest(detailedRequest, { quotesCount, booking }),
  };
}

export async function cancelRequest(customer, requestId) {
  const request = await findCustomerRequestOrFail(requestId, customer);

  assertTransition(request.status, REQUEST_STATUSES.CANCELLED);

  const cancelled = await ServiceRequest.findOneAndUpdate(
    { _id: request.id, customerId: customer.id, status: request.status },
    { $set: { status: REQUEST_STATUSES.CANCELLED } },
    { returnDocument: 'after' },
  ).populate(CUSTOMER_POPULATE);

  if (!cancelled) {
    throw new ApiError(409, 'Service request was updated, please retry', 'REQUEST_CONFLICT');
  }

  await syncBookingWithRequest(cancelled);

  return {
    request: toCustomerRequest(cancelled),
  };
}

async function applyProviderTransition(provider, requestId, targetStatus, extraFields = {}) {
  const request = await findRequestOrFail(requestId);

  if (!isSameId(request.selectedProviderId, provider.id)) {
    throw new ApiError(403, 'Access denied', 'FORBIDDEN');
  }

  assertTransition(request.status, targetStatus);

  const updated = await ServiceRequest.findOneAndUpdate(
    { _id: request.id, selectedProviderId: provider.id, status: request.status },
    { $set: { status: targetStatus, ...extraFields } },
    { returnDocument: 'after' },
  ).populate(PROVIDER_DETAIL_POPULATE);

  if (!updated) {
    throw new ApiError(409, 'Service request was updated, please retry', 'REQUEST_CONFLICT');
  }

  await syncBookingWithRequest(updated);

  const ownQuote = await Quote.findOne({ requestId: updated.id, providerId: provider.id });

  return {
    request: toProviderRequest(updated, { ownQuote }),
  };
}

export async function scheduleRequest(provider, requestId, input) {
  const scheduledDate = parseDateOnly(input?.scheduledDate, 'Scheduled date');
  const scheduledTime = normalizeTimeOfDay(input?.scheduledTime, 'Scheduled time');

  assertNotPastDate(scheduledDate, 'Scheduled date');

  return applyProviderTransition(provider, requestId, REQUEST_STATUSES.SCHEDULED, {
    scheduledDate,
    scheduledTime,
  });
}

export function startRequest(provider, requestId) {
  return applyProviderTransition(provider, requestId, REQUEST_STATUSES.IN_PROGRESS);
}

export function completeRequest(provider, requestId) {
  return applyProviderTransition(provider, requestId, REQUEST_STATUSES.COMPLETED);
}

export async function listAvailableRequests(_provider, query) {
  const status = parseStatusFilter(query?.status, QUOTABLE_REQUEST_STATUSES);
  const requests = await ServiceRequest.find({
    status: status || REQUEST_STATUSES.PENDING,
  })
    .sort({ createdAt: -1 })
    .populate({ path: 'serviceId' });

  return {
    requests: requests.map(toProviderRequestSummary),
  };
}

// Jobs the customer awarded to this provider, with booking state when one exists.
export async function listProviderJobs(provider, query) {
  const status = parseStatusFilter(query?.status, Object.values(REQUEST_STATUSES));
  const bookingStatus = parseStatusFilter(query?.bookingStatus, Object.values(BOOKING_STATUSES));
  const filter = { selectedProviderId: provider.id };

  if (status) {
    filter.status = status;
  }

  const requests = await ServiceRequest.find(filter)
    .sort({ updatedAt: -1 })
    .populate(PROVIDER_JOB_POPULATE);

  const bookings = await Booking.find({
    requestId: { $in: requests.map((request) => request._id) },
    providerId: provider.id,
  });
  const bookingByRequest = new Map(
    bookings.map((booking) => [toIdString(booking.requestId), booking]),
  );

  let jobs = requests.map((request) => toProviderJob(request, bookingByRequest.get(request.id)));

  if (bookingStatus) {
    jobs = jobs.filter((job) => job.bookingStatus === bookingStatus);
  }

  return { jobs };
}

export async function assertProviderCanAccessRequest(request, provider) {
  if (
    QUOTABLE_REQUEST_STATUSES.includes(request.status) ||
    isSameId(request.selectedProviderId, provider.id)
  ) {
    return;
  }

  const ownQuote = await Quote.exists({ requestId: request.id, providerId: provider.id });

  if (!ownQuote) {
    throw new ApiError(403, 'Access denied', 'FORBIDDEN');
  }
}

export async function getProviderRequest(provider, requestId) {
  const request = await findRequestOrFail(requestId);

  await assertProviderCanAccessRequest(request, provider);

  const [detailedRequest, ownQuote] = await Promise.all([
    ServiceRequest.findById(request.id).populate(PROVIDER_DETAIL_POPULATE),
    Quote.findOne({ requestId: request.id, providerId: provider.id }),
  ]);

  return {
    request: toProviderRequest(detailedRequest, { ownQuote }),
  };
}

export async function markRequestQuoteReceived(request) {
  if (request.status !== REQUEST_STATUSES.PENDING) {
    return;
  }

  assertTransition(request.status, REQUEST_STATUSES.QUOTE_RECEIVED);

  await ServiceRequest.updateOne(
    { _id: request.id, status: REQUEST_STATUSES.PENDING },
    { $set: { status: REQUEST_STATUSES.QUOTE_RECEIVED } },
  );
}

export async function acceptQuoteOnRequest(request, quote, customer) {
  assertTransition(request.status, REQUEST_STATUSES.QUOTE_ACCEPTED);

  const updated = await ServiceRequest.findOneAndUpdate(
    { _id: request.id, customerId: customer.id, status: REQUEST_STATUSES.QUOTE_RECEIVED },
    {
      $set: {
        status: REQUEST_STATUSES.QUOTE_ACCEPTED,
        selectedProviderId: quote.providerId,
        acceptedQuoteId: quote.id,
      },
    },
    { returnDocument: 'after' },
  );

  if (!updated) {
    throw new ApiError(409, 'Service request was updated, please retry', 'REQUEST_CONFLICT');
  }

  return updated;
}

export async function presentCustomerRequestById(requestId) {
  const [request, booking] = await Promise.all([
    loadCustomerRequest(requestId),
    Booking.findOne({ requestId }),
  ]);

  return toCustomerRequest(request, { booking });
}
