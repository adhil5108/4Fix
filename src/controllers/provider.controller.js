import {
  getProviderRequest as getProviderRequestService,
  listAvailableRequests,
} from '../services/request.service.js';

export async function listProviderRequests(req, res) {
  const result = await listAvailableRequests(req.user, req.query);

  res.status(200).json(result);
}

export async function getProviderRequest(req, res) {
  const result = await getProviderRequestService(req.user, req.params.requestId);

  res.status(200).json(result);
}
