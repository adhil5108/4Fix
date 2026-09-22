import {
  getService as getServiceService,
  listServices as listServicesService,
  searchServices as searchServicesService,
} from '../services/service.service.js';

export async function listServices(req, res) {
  const result = await listServicesService(req.query);

  res.status(200).json(result);
}

export async function searchServices(req, res) {
  const result = await searchServicesService(req.query);

  res.status(200).json(result);
}

export async function getService(req, res) {
  const result = await getServiceService(req.params.serviceId);

  res.status(200).json(result);
}
