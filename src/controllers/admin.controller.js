import { getAdminDashboard } from '../services/adminDashboard.service.js';
import {
  createAdminService,
  deleteAdminService,
  getAdminService,
  listAdminServices,
  updateAdminService,
} from '../services/adminServices.service.js';
import {
  getAdminProvider,
  listAdminProviders,
  setAdminProviderStatus,
} from '../services/adminProviders.service.js';
import { getAdminCustomer, listAdminCustomers } from '../services/adminCustomers.service.js';
import { getAdminRequest, listAdminRequests } from '../services/adminRequests.service.js';
import { getAdminQuote, listAdminQuotes } from '../services/adminQuotes.service.js';
import { adminAssignQuote } from '../services/quote.service.js';
import { getAdminBooking, listAdminBookings } from '../services/adminBookings.service.js';
import { getAdminPayment, listAdminPayments } from '../services/adminPayments.service.js';
import { getAdminReview, listAdminReviews } from '../services/adminReviews.service.js';

export async function getDashboard(_req, res) {
  res.status(200).json(await getAdminDashboard());
}

// Services

export async function listServices(req, res) {
  res.status(200).json(await listAdminServices(req.query));
}

export async function getService(req, res) {
  res.status(200).json(await getAdminService(req.params.serviceId));
}

export async function createService(req, res) {
  res.status(201).json(await createAdminService(req.body));
}

export async function updateService(req, res) {
  res.status(200).json(await updateAdminService(req.params.serviceId, req.body));
}

export async function deleteService(req, res) {
  res.status(200).json(await deleteAdminService(req.params.serviceId));
}

// Providers

export async function listProviders(req, res) {
  res.status(200).json(await listAdminProviders(req.query));
}

export async function getProvider(req, res) {
  res.status(200).json(await getAdminProvider(req.params.providerId));
}

export async function updateProviderStatus(req, res) {
  res.status(200).json(await setAdminProviderStatus(req.params.providerId, req.body?.isActive));
}

// Customers

export async function listCustomers(req, res) {
  res.status(200).json(await listAdminCustomers(req.query));
}

export async function getCustomer(req, res) {
  res.status(200).json(await getAdminCustomer(req.params.customerId));
}

// Requests

export async function listRequests(req, res) {
  res.status(200).json(await listAdminRequests(req.query));
}

export async function getRequest(req, res) {
  res.status(200).json(await getAdminRequest(req.params.requestId));
}

// Quotes

export async function listQuotes(req, res) {
  res.status(200).json(await listAdminQuotes(req.query));
}

export async function getQuote(req, res) {
  res.status(200).json(await getAdminQuote(req.params.quoteId));
}

export async function assignQuote(req, res) {
  res.status(200).json(await adminAssignQuote(req.params.quoteId));
}

// Bookings

export async function listBookings(req, res) {
  res.status(200).json(await listAdminBookings(req.query));
}

export async function getBooking(req, res) {
  res.status(200).json(await getAdminBooking(req.params.bookingId));
}

// Payments

export async function listPayments(req, res) {
  res.status(200).json(await listAdminPayments(req.query));
}

export async function getPayment(req, res) {
  res.status(200).json(await getAdminPayment(req.params.paymentId));
}

// Reviews

export async function listReviews(req, res) {
  res.status(200).json(await listAdminReviews(req.query));
}

export async function getReview(req, res) {
  res.status(200).json(await getAdminReview(req.params.reviewId));
}
