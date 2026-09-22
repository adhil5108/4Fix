import Service, { OTHER_ISSUE_KEY } from '../models/Service.js';
import ServiceRequest from '../models/ServiceRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { parseObjectId } from '../utils/objectId.js';
import { parsePagination, toPageResult } from '../utils/pagination.js';
import { optionalText, requiredText } from '../utils/text.js';
import { toPublicService } from './servicePresenter.service.js';

// Unlike the customer-facing presenter, admin sees every issue (including inactive
// ones) exactly as stored, and never a synthesized "Something else" entry.
function toAdminService(service) {
  return {
    ...toPublicService(service),
    isActive: service.isActive,
    issues: (service.issues || []).map((issue) => ({
      key: issue.key,
      label: issue.label,
      description: issue.description ?? null,
      isActive: issue.isActive,
    })),
  };
}

function validateIssue(rawIssue, index) {
  if (!rawIssue || typeof rawIssue !== 'object' || Array.isArray(rawIssue)) {
    throw new ApiError(400, `Issue ${index + 1} is invalid`, 'VALIDATION_ERROR');
  }

  const key = requiredText(rawIssue.key, `Issue ${index + 1} key`, 1, 60).toUpperCase();

  if (key === OTHER_ISSUE_KEY) {
    throw new ApiError(400, `"${OTHER_ISSUE_KEY}" is a reserved issue key`, 'VALIDATION_ERROR');
  }

  return {
    key,
    label: requiredText(rawIssue.label, `Issue ${index + 1} label`, 1, 120),
    description: optionalText(rawIssue.description, `Issue ${index + 1} description`, 300),
    isActive: rawIssue.isActive === undefined ? true : Boolean(rawIssue.isActive),
  };
}

function validateIssues(issues) {
  if (issues === undefined) {
    return undefined;
  }

  if (!Array.isArray(issues)) {
    throw new ApiError(400, 'Issues must be an array', 'VALIDATION_ERROR');
  }

  if (issues.length > 30) {
    throw new ApiError(400, 'A service supports at most 30 issues', 'VALIDATION_ERROR');
  }

  const mapped = issues.map(validateIssue);
  const keys = new Set(mapped.map((issue) => issue.key));

  if (keys.size !== mapped.length) {
    throw new ApiError(400, 'Issue keys must be unique', 'VALIDATION_ERROR');
  }

  return mapped;
}

function validateStartingPrice(value) {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ApiError(400, 'Starting price must be a non-negative number', 'VALIDATION_ERROR');
  }

  return Math.round(value * 100) / 100;
}

function validateBoolean(value, fieldName) {
  if (typeof value !== 'boolean') {
    throw new ApiError(400, `${fieldName} must be true or false`, 'VALIDATION_ERROR');
  }

  return value;
}

// `partial`: PATCH only validates fields that were actually sent; POST requires the
// core fields every time.
function buildServiceFields(input, { partial }) {
  const fields = {};

  if (!partial || input?.name !== undefined) {
    fields.name = requiredText(input?.name, 'Name', 2, 120);
  }

  if (!partial || input?.description !== undefined) {
    fields.description = requiredText(input?.description, 'Description', 5, 1000);
  }

  if (!partial || input?.category !== undefined) {
    fields.category = requiredText(input?.category, 'Category', 2, 60).toUpperCase();
  }

  if (input?.image !== undefined) {
    fields.image = optionalText(input.image, 'Image', 500);
  }

  if (input?.startingPrice !== undefined) {
    fields.startingPrice = validateStartingPrice(input.startingPrice);
  }

  if (input?.isPopular !== undefined) {
    fields.isPopular = validateBoolean(input.isPopular, 'isPopular');
  }

  if (input?.isActive !== undefined) {
    fields.isActive = validateBoolean(input.isActive, 'isActive');
  }

  const issues = validateIssues(input?.issues);

  if (issues !== undefined) {
    fields.issues = issues;
  }

  return fields;
}

export async function findAdminServiceOrFail(serviceId) {
  const id = parseObjectId(serviceId, 'serviceId');
  const service = await Service.findById(id);

  if (!service) {
    throw new ApiError(404, 'Service not found', 'SERVICE_NOT_FOUND');
  }

  return service;
}

export async function listAdminServices(query) {
  const pagination = parsePagination(query);
  const filter = {};

  if (query?.isActive === 'true') {
    filter.isActive = true;
  } else if (query?.isActive === 'false') {
    filter.isActive = false;
  }

  if (query?.category) {
    filter.category = String(query.category).trim().toUpperCase();
  }

  const [services, total] = await Promise.all([
    Service.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.pageSize),
    Service.countDocuments(filter),
  ]);

  return toPageResult('services', services.map(toAdminService), pagination, total);
}

export async function getAdminService(serviceId) {
  return { service: toAdminService(await findAdminServiceOrFail(serviceId)) };
}

export async function createAdminService(input) {
  const fields = buildServiceFields(input, { partial: false });
  const service = await Service.create({ ...fields, issues: fields.issues || [] });

  return { service: toAdminService(service) };
}

export async function updateAdminService(serviceId, input) {
  const existing = await findAdminServiceOrFail(serviceId);
  const fields = buildServiceFields(input, { partial: true });

  if (Object.keys(fields).length === 0) {
    throw new ApiError(400, 'No changes were provided', 'VALIDATION_ERROR');
  }

  const updated = await Service.findByIdAndUpdate(
    existing.id,
    { $set: fields },
    { returnDocument: 'after' },
  );

  return { service: toAdminService(updated) };
}

// Destructive delete only when nothing references the service; otherwise the admin
// is told to deactivate it instead, per the "prefer soft-deactivation" rule.
export async function deleteAdminService(serviceId) {
  const service = await findAdminServiceOrFail(serviceId);
  const referenced = await ServiceRequest.exists({ serviceId: service.id });

  if (referenced) {
    throw new ApiError(
      409,
      'This service has existing requests and cannot be deleted. Deactivate it instead.',
      'SERVICE_IN_USE',
    );
  }

  await Service.deleteOne({ _id: service.id });

  return { deleted: true };
}
