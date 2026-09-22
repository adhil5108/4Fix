import Payment, { PAYMENT_STATUSES } from '../models/Payment.js';
import { ApiError } from '../utils/ApiError.js';
import { parseDateOnly } from '../utils/dateTime.js';
import { parseObjectId } from '../utils/objectId.js';
import { parsePagination, toPageResult } from '../utils/pagination.js';
import { toPayment } from './paymentPresenter.service.js';

function parsePaymentStatusFilter(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const status = String(value).trim().toUpperCase();

  if (!Object.values(PAYMENT_STATUSES).includes(status)) {
    throw new ApiError(
      400,
      `Status must be one of: ${Object.values(PAYMENT_STATUSES).join(', ')}`,
      'VALIDATION_ERROR',
    );
  }

  return status;
}

export async function listAdminPayments(query) {
  const pagination = parsePagination(query);
  const filter = {};

  const status = parsePaymentStatusFilter(query?.status);
  if (status) {
    filter.status = status;
  }

  if (query?.provider) {
    filter.providerId = parseObjectId(query.provider, 'provider');
  }

  if (query?.customer) {
    filter.customerId = parseObjectId(query.customer, 'customer');
  }

  if (query?.from || query?.to) {
    filter.createdAt = {};

    if (query.from) {
      filter.createdAt.$gte = parseDateOnly(query.from, 'From date');
    }

    if (query.to) {
      filter.createdAt.$lte = parseDateOnly(query.to, 'To date');
    }
  }

  const [payments, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.pageSize),
    Payment.countDocuments(filter),
  ]);

  return toPageResult('payments', payments.map(toPayment), pagination, total);
}

export async function getAdminPayment(paymentId) {
  const id = parseObjectId(paymentId, 'paymentId');
  const payment = await Payment.findById(id);

  if (!payment) {
    throw new ApiError(404, 'Payment not found', 'PAYMENT_NOT_FOUND');
  }

  return { payment: toPayment(payment) };
}
