import Service from '../models/Service.js';
import { ApiError } from '../utils/ApiError.js';
import { parseObjectId } from '../utils/objectId.js';
import { toPublicService } from './servicePresenter.service.js';

export async function getActiveServiceOrFail(serviceId) {
  const id = parseObjectId(serviceId, 'serviceId');
  const service = await Service.findOne({ _id: id, isActive: true });

  if (!service) {
    throw new ApiError(404, 'Service not found', 'SERVICE_NOT_FOUND');
  }

  return service;
}

export async function listServices(query) {
  const filter = { isActive: true };
  const category =
    typeof query?.category === 'string' ? query.category.trim().toUpperCase() : '';

  if (category) {
    filter.category = category;
  }

  const services = await Service.find(filter).sort({ category: 1, name: 1 });

  return {
    services: services.map(toPublicService),
  };
}

export async function getService(serviceId) {
  return {
    service: toPublicService(await getActiveServiceOrFail(serviceId)),
  };
}
