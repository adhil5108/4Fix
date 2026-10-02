import Category from '../models/Category.js';
import Service from '../models/Service.js';
import { ApiError } from '../utils/ApiError.js';
import { parseObjectId } from '../utils/objectId.js';
import { escapeRegex } from '../utils/text.js';
import { visibleServiceFilter } from './category.service.js';
import { toPublicService, toServiceDetail } from './servicePresenter.service.js';

const MAX_SEARCH_LENGTH = 80;

// A service in a disabled category is no longer offered, so it can't be booked either.
export async function getActiveServiceOrFail(serviceId) {
  const id = parseObjectId(serviceId, 'serviceId');
  const service = await Service.findOne({ _id: id, ...(await visibleServiceFilter()) }).populate(
    'categoryId',
  );

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
  const filter = await visibleServiceFilter();
  const search = parseSearch(query?.search);

  // Replaces the inactive-category exclusion: a disabled category lists nothing.
  if (query?.category) {
    const categoryId = parseObjectId(String(query.category), 'category');

    if (!(await Category.exists({ _id: categoryId, isActive: true }))) {
      return { services: [] };
    }

    filter.categoryId = categoryId;
  }

  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    const matchingCategories = await Category.find({ name: pattern, isActive: true }).distinct('_id');

    filter.$or = [
      { name: pattern },
      { description: pattern },
      { categoryId: { $in: matchingCategories } },
    ];
  }

  if (query?.popular === 'true') {
    filter.isPopular = true;
  }

  const services = await Service.find(filter).sort({ name: 1 }).populate('categoryId');

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
