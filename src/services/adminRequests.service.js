import Booking from '../models/Booking.js';
import Payment from '../models/Payment.js';
import Quote from '../models/Quote.js';
import Review from '../models/Review.js';
import ServiceRequest, { REQUEST_STATUSES } from '../models/ServiceRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { parseDateOnly } from '../utils/dateTime.js';
import { parseObjectId } from '../utils/objectId.js';
import { parsePagination, toPageResult } from '../utils/pagination.js';
import { escapeRegex } from '../utils/text.js';
import { toBookingForCustomer } from './bookingPresenter.service.js';
import { toPayment } from './paymentPresenter.service.js';
import { toQuoteForCustomer } from './quotePresenter.service.js';
import { CUSTOMER_DETAIL_POPULATE, CUSTOMER_POPULATE, parseStatusFilter } from './request.service.js';
import { isPopulated, toCustomerRequest } from './requestPresenter.service.js';
import { toReview } from './reviewPresenter.service.js';
import { toUserSummary } from './userPresenter.service.js';

// `toCustomerRequest` already has everything (service, issue, address, selected
// provider, accepted quote); admin additionally needs to know whose request it is.
function toAdminRequest(request, extra) {
  return {
    ...toCustomerRequest(request, extra),
    customer: isPopulated(request.customerId) ? toUserSummary(request.customerId) : null,
  };
}

export async function listAdminRequests(query) {
  const pagination = parsePagination(query);
  const filter = {};

  const status = parseStatusFilter(query?.status, Object.values(REQUEST_STATUSES));
  if (status) {
    filter.status = status;
  }

  if (query?.service) {
    filter.serviceId = parseObjectId(query.service, 'service');
  }

  if (query?.provider) {
    filter.selectedProviderId = parseObjectId(query.provider, 'provider');
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

  if (query?.search) {
    filter.description = new RegExp(escapeRegex(String(query.search).trim()), 'i');
  }

  const [requests, total] = await Promise.all([
    ServiceRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.pageSize)
      .populate([...CUSTOMER_POPULATE, { path: 'customerId' }]),
    ServiceRequest.countDocuments(filter),
  ]);

  return toPageResult('requests', requests.map((request) => toAdminRequest(request)), pagination, total);
}

async function findAdminRequestOrFail(requestId) {
  const id = parseObjectId(requestId, 'requestId');
  const request = await ServiceRequest.findById(id).populate([
    ...CUSTOMER_DETAIL_POPULATE,
    { path: 'customerId' },
  ]);

  if (!request) {
    throw new ApiError(404, 'Service request not found', 'REQUEST_NOT_FOUND');
  }

  return request;
}

// Everything the admin request-details page needs in one call: the request itself,
// every quote it has received, and the resulting booking/payment/review if any exist.
export async function getAdminRequest(requestId) {
  const request = await findAdminRequestOrFail(requestId);

  const [quotes, booking] = await Promise.all([
    Quote.find({ requestId: request.id }).sort({ createdAt: -1 }).populate({ path: 'providerId' }),
    Booking.findOne({ requestId: request.id }).populate([
      { path: 'requestId', populate: { path: 'serviceId' } },
      { path: 'quoteId' },
      { path: 'providerId' },
      { path: 'customerId' },
    ]),
  ]);

  const [payment, review] = booking
    ? await Promise.all([
        Payment.findOne({ bookingId: booking.id }),
        Review.findOne({ bookingId: booking.id }),
      ])
    : [null, null];

  return {
    request: toAdminRequest(request, { quotesCount: quotes.length }),
    quotes: quotes.map(toQuoteForCustomer),
    booking: booking ? toBookingForCustomer(booking) : null,
    payment: payment ? toPayment(payment) : null,
    review: review ? toReview(review) : null,
  };
}
