import Booking, { BOOKING_STATUSES } from '../models/Booking.js';
import { OTHER_ISSUE_KEY } from '../models/Service.js';
import ServiceRequest, { REQUEST_STATUSES } from '../models/ServiceRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { isSameId, parseObjectId, toIdString } from '../utils/objectId.js';
import {
  assertTransition,
  OPEN_REQUEST_STATUSES,
} from '../utils/requestStateMachine.js';
import { generateAccessToken, hashAccessToken } from '../utils/accessToken.js';
import { normalizePhoneNumber } from '../utils/normalizePhone.js';
import { parseCoordinate } from '../utils/location.js';
import { optionalText, requiredText } from '../utils/text.js';
import { ensureBookingForAcceptedRequest, loadBooking } from './booking.service.js';
import { toBookingForProvider } from './bookingPresenter.service.js';
import { syncBookingWithRequest } from './bookingSync.service.js';
import { listExternalJobsForProvider } from './externalJob.service.js';
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

const PROVIDER_DETAIL_POPULATE = [{ path: 'serviceId' }, { path: 'customerId' }];

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
    throw new ApiError(400, 'Location or address is required', 'VALIDATION_ERROR');
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

// Name and phone are how the assigned provider reaches an account-less customer. They
// are contact details only — access to the request stays with the access token.
function validateCustomerDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    throw new ApiError(400, 'Customer details are required', 'VALIDATION_ERROR');
  }

  return {
    name: requiredText(details.name, 'Customer name', 2, 120),
    phone: normalizePhoneNumber(details.phone),
  };
}

function validateLocation(location) {
  if (location === undefined || location === null) {
    return null;
  }

  if (typeof location !== 'object' || Array.isArray(location)) {
    throw new ApiError(400, 'Location must be an object', 'VALIDATION_ERROR');
  }

  return {
    latitude: parseCoordinate(location.latitude, 'Latitude', 90),
    longitude: parseCoordinate(location.longitude, 'Longitude', 180),
    address: optionalText(location.address, 'Location address', 240) || null,
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

// `customer` is the anonymous principal from the request access token; it may only
// reach the one request that token was issued for.
export async function findCustomerRequestOrFail(requestId, customer) {
  const request = await findRequestOrFail(requestId);

  if (!customer?.requestId || !isSameId(request.id, customer.requestId)) {
    throw new ApiError(403, 'Access denied', 'FORBIDDEN');
  }

  return request;
}

async function loadCustomerRequest(requestId) {
  return ServiceRequest.findById(requestId).populate(CUSTOMER_POPULATE);
}

// Anonymous: no account is involved. The customer owns the request through a random
// access token returned once here; only its hash is stored.
export async function createRequest(input) {
  const service = await getActiveServiceOrFail(input?.serviceId);
  const issue = resolveIssue(service, input?.issueKey);
  const customerDetails = validateCustomerDetails(input?.customerDetails);
  const description = requiredText(input?.description, 'Description', 5, 2000);
  const attachments = validateAttachments(input?.attachments);
  const voiceNote = validateVoiceNote(input?.voiceNote);
  const location = validateLocation(input?.location);
  // A captured location replaces the typed address; without one, the address is required.
  const address =
    location && (input?.address === undefined || input?.address === null)
      ? null
      : validateAddress(input?.address);

  const accessToken = generateAccessToken();
  const created = await ServiceRequest.create({
    customerId: null,
    customerDetails,
    accessTokenHash: hashAccessToken(accessToken),
    serviceId: service.id,
    issueKey: issue.issueKey,
    issueLabel: issue.issueLabel,
    description,
    attachments,
    voiceNote,
    address,
    location,
    status: REQUEST_STATUSES.PENDING,
    selectedProviderId: null,
  });

  await created.populate(CUSTOMER_POPULATE);

  return {
    request: toCustomerRequest(created),
    accessToken,
  };
}

export async function getCustomerRequest(customer, requestId) {
  const request = await findCustomerRequestOrFail(requestId, customer);
  const [detailedRequest, booking] = await Promise.all([
    loadCustomerRequest(request.id),
    Booking.findOne({ requestId: request.id }),
  ]);

  return {
    request: toCustomerRequest(detailedRequest, { booking }),
  };
}

export async function cancelRequest(customer, requestId) {
  const request = await findCustomerRequestOrFail(requestId, customer);

  assertTransition(request.status, REQUEST_STATUSES.CANCELLED);

  const cancelled = await ServiceRequest.findOneAndUpdate(
    { _id: request.id, status: request.status },
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

  return {
    request: toProviderRequest(updated, { includeLocation: true }),
  };
}

export function startRequest(provider, requestId) {
  return applyProviderTransition(provider, requestId, REQUEST_STATUSES.IN_PROGRESS);
}

export function completeRequest(provider, requestId) {
  return applyProviderTransition(provider, requestId, REQUEST_STATUSES.COMPLETED);
}

export async function listAvailableRequests(_provider, query) {
  const status = parseStatusFilter(query?.status, OPEN_REQUEST_STATUSES);
  const requests = await ServiceRequest.find({
    status: status || REQUEST_STATUSES.PENDING,
  })
    .sort({ createdAt: -1 })
    .populate({ path: 'serviceId' });

  return {
    requests: requests.map(toProviderRequestSummary),
  };
}

// Requests this provider accepted, with booking state when one exists.
export async function listProviderJobs(provider, query) {
  const status = parseStatusFilter(query?.status, Object.values(REQUEST_STATUSES));
  const bookingStatus = parseStatusFilter(query?.bookingStatus, Object.values(BOOKING_STATUSES));
  const filter = { selectedProviderId: provider.id };

  if (status) {
    filter.status = status;
  }

  const requests = await ServiceRequest.find(filter)
    .sort({ updatedAt: -1 })
    .populate(PROVIDER_DETAIL_POPULATE);

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

  // External jobs use their own status vocabulary (SCHEDULED/ON_THE_WAY/…), which
  // doesn't map onto `status`/`bookingStatus` filters, so they only join the default,
  // unfiltered "My Jobs" call — filtered calls keep their exact previous behavior.
  if (!status && !bookingStatus) {
    const externalJobs = await listExternalJobsForProvider(provider.id);
    jobs = [...jobs, ...externalJobs].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  return { jobs };
}

// Open requests are visible to every provider; once accepted, only to the assignee.
function assertProviderCanAccessRequest(request, provider) {
  if (
    OPEN_REQUEST_STATUSES.includes(request.status) ||
    isSameId(request.selectedProviderId, provider.id)
  ) {
    return;
  }

  throw new ApiError(403, 'Access denied', 'FORBIDDEN');
}

export async function getProviderRequest(provider, requestId) {
  const request = await findRequestOrFail(requestId);

  assertProviderCanAccessRequest(request, provider);

  const [detailedRequest, booking] = await Promise.all([
    ServiceRequest.findById(request.id).populate(PROVIDER_DETAIL_POPULATE),
    Booking.findOne({ requestId: request.id, providerId: provider.id }),
  ]);

  // Coordinates are for the assigned provider only, never for providers browsing.
  return {
    request: toProviderRequest(detailedRequest, {
      includeLocation: isSameId(request.selectedProviderId, provider.id),
      booking,
    }),
  };
}

async function presentAcceptedRequest(requestId) {
  const request = await ServiceRequest.findById(requestId).populate(PROVIDER_DETAIL_POPULATE);
  const booking = await ensureBookingForAcceptedRequest(request);

  return {
    request: toProviderRequest(request, { includeLocation: true, booking }),
    booking: toBookingForProvider(await loadBooking(booking.id)),
  };
}

// A provider claims an open request. The claim is a single conditional update on
// { status: PENDING, selectedProviderId: null }, so when providers race exactly one
// write matches; everyone else gets 409. Repeating the call as the winner is a no-op
// that returns the same job (the booking's unique requestId prevents duplicates).
export async function acceptRequest(provider, requestId) {
  const request = await findRequestOrFail(requestId);

  if (isSameId(request.selectedProviderId, provider.id)) {
    return presentAcceptedRequest(request.id);
  }

  const claimed = await ServiceRequest.findOneAndUpdate(
    { _id: request.id, status: REQUEST_STATUSES.PENDING, selectedProviderId: null },
    {
      $set: {
        status: REQUEST_STATUSES.ACCEPTED,
        selectedProviderId: provider.id,
        acceptedAt: new Date(),
      },
    },
    { returnDocument: 'after' },
  );

  if (!claimed) {
    const current = await ServiceRequest.findById(request.id);

    if (isSameId(current?.selectedProviderId, provider.id)) {
      return presentAcceptedRequest(request.id);
    }

    if (current?.selectedProviderId) {
      throw new ApiError(409, 'This job has already been accepted.', 'REQUEST_ALREADY_ACCEPTED');
    }

    throw new ApiError(409, 'This request is no longer open.', 'REQUEST_NOT_OPEN');
  }

  return presentAcceptedRequest(claimed.id);
}
