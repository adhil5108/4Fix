import {
  acceptRequest as acceptRequestService,
  cancelRequest as cancelRequestService,
  completeRequest as completeRequestService,
  createRequest as createRequestService,
  getCustomerRequest,
  listCustomerRequests,
  scheduleRequest as scheduleRequestService,
  startRequest as startRequestService,
} from '../services/request.service.js';

export async function createRequest(req, res) {
  const result = await createRequestService(req.user, req.body);

  res.status(201).json(result);
}

export async function listRequests(req, res) {
  const result = await listCustomerRequests(req.user, req.query);

  res.status(200).json(result);
}

export async function getRequest(req, res) {
  const result = await getCustomerRequest(req.user, req.params.requestId);

  res.status(200).json(result);
}

export async function cancelRequest(req, res) {
  const result = await cancelRequestService(req.user, req.params.requestId);

  res.status(200).json(result);
}

export async function acceptRequest(req, res) {
  const result = await acceptRequestService(req.user, req.params.requestId);

  res.status(200).json(result);
}

export async function scheduleRequest(req, res) {
  const result = await scheduleRequestService(req.user, req.params.requestId, req.body);

  res.status(200).json(result);
}

export async function startRequest(req, res) {
  const result = await startRequestService(req.user, req.params.requestId);

  res.status(200).json(result);
}

export async function completeRequest(req, res) {
  const result = await completeRequestService(req.user, req.params.requestId);

  res.status(200).json(result);
}
