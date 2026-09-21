import Service from '../models/Service.js';
import { ApiError } from '../utils/ApiError.js';
import { parseObjectId } from '../utils/objectId.js';
import { escapeRegex } from '../utils/text.js';
import { toPublicService, toServiceDetail } from './servicePresenter.service.js';

const MAX_SEARCH_LENGTH = 80;

export async function getActiveServiceOrFail(serviceId) {
  const id = parseObjectId(serviceId, 'serviceId');
  const service = await Service.findOne({ _id: id, isActive: true });

  if (!service) {
    throw new ApiError(404, 'Service not found', 'SERVICE_NOT_FOUND');
  }

  return service;
}

function parseSearch(value) {
  const search = typeof value === 'string' ? value.trim() : '';

  if (search.length > MAX_SEARCH_LENGTH) {
    throw new ApiError(
      400,
      `Search must be ${MAX_SEARCH_LENGTH} characters or fewer`,
      'VALIDATION_ERROR',
    );
  }

  return search;
}

export async function listServices(query) {
  const filter = { isActive: true };
  const category =
    typeof query?.category === 'string' ? query.category.trim().toUpperCase() : '';
  const search = parseSearch(query?.search);

  if (category) {
    filter.category = category;
  }

  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');

    filter.$or = [{ name: pattern }, { description: pattern }, { category: pattern }];
  }

  if (query?.popular === 'true') {
    filter.isPopular = true;
  }

  const services = await Service.find(filter).sort({ category: 1, name: 1 });

  return {
    services: services.map(toPublicService),
  };
}

// GET /api/services/search?q= is a thin alias of GET /api/services?search=
export function searchServices(query) {
  return listServices({ ...query, search: query?.q ?? query?.search });
}

export async function getService(serviceId) {
  return {
    service: toServiceDetail(await getActiveServiceOrFail(serviceId)),
  };
}
