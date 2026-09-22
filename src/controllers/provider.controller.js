import {
  getPublicProvider as getPublicProviderService,
  listProvidersForRequest as listProvidersForRequestService,
} from '../services/provider.service.js';
import {
  getProviderRequest as getProviderRequestService,
  listAvailableRequests,
  listProviderJobs as listProviderJobsService,
} from '../services/request.service.js';

export async function listProviderRequests(req, res) {
  const result = await listAvailableRequests(req.user, req.query);

  res.status(200).json(result);
}

export async function getProviderRequest(req, res) {
  const result = await getProviderRequestService(req.user, req.params.requestId);

  res.status(200).json(result);
}

export async function listProviderJobs(req, res) {
  const result = await listProviderJobsService(req.user, req.query);

  res.status(200).json(result);
}

export async function getPublicProvider(req, res) {
  const result = await getPublicProviderService(req.params.providerId);

  res.status(200).json(result);
}

export async function listRequestProviders(req, res) {
  const result = await listProvidersForRequestService(req.user, req.params.requestId);

  res.status(200).json(result);
}
