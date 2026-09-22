import Booking from '../models/Booking.js';
import Quote, { QUOTE_STATUSES } from '../models/Quote.js';
import ServiceRequest from '../models/ServiceRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { parseDateOnly } from '../utils/dateTime.js';
import { isSameId, parseObjectId, toIdString } from '../utils/objectId.js';
import { parsePagination, toPageResult } from '../utils/pagination.js';
import { toPublicService } from './servicePresenter.service.js';
import { toQuoteForCustomer } from './quotePresenter.service.js';
import { isPopulated } from './requestPresenter.service.js';
import { toUserSummary } from './userPresenter.service.js';

// The full row the admin quotes table needs: quote + who it's for + whether it won.
// Exported so the dashboard's "recent quotes" widget can reuse the same shape.
export function toAdminQuote(quote, request) {
  return {
    ...toQuoteForCustomer(quote),
    request: request
      ? {
          id: toIdString(request._id ?? request.id),
          status: request.status,
          service: isPopulated(request.serviceId) ? toPublicService(request.serviceId) : null,
          customer: isPopulated(request.customerId) ? toUserSummary(request.customerId) : null,
        }
      : null,
    isSelected: Boolean(request) && isSameId(request.acceptedQuoteId, quote.id),
  };
}

function parseQuoteStatusFilter(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const status = String(value).trim().toUpperCase();

  if (!Object.values(QUOTE_STATUSES).includes(status)) {
    throw new ApiError(
      400,
      `Status must be one of: ${Object.values(QUOTE_STATUSES).join(', ')}`,
      'VALIDATION_ERROR',
    );
  }

  return status;
}

export async function listAdminQuotes(query) {
  const pagination = parsePagination(query);
  const filter = {};

  const status = parseQuoteStatusFilter(query?.status);
  if (status) {
    filter.status = status;
  }

  if (query?.provider) {
    filter.providerId = parseObjectId(query.provider, 'provider');
  }

  // Quotes don't carry customer/service directly, so request/customer/service filters
  // all resolve through a single matching-requests lookup first.
  if (query?.request || query?.customer || query?.service) {
    const requestFilter = {};

    if (query.request) {
      requestFilter._id = parseObjectId(query.request, 'request');
    }

    if (query.customer) {
      requestFilter.customerId = parseObjectId(query.customer, 'customer');
    }

    if (query.service) {
      requestFilter.serviceId = parseObjectId(query.service, 'service');
    }

    const matchingRequestIds = await ServiceRequest.find(requestFilter).distinct('_id');

    if (matchingRequestIds.length === 0) {
      return toPageResult('quotes', [], pagination, 0);
    }

    filter.requestId = { $in: matchingRequestIds };
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

  const [quotes, total] = await Promise.all([
    Quote.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.pageSize)
      .populate({ path: 'providerId' }),
    Quote.countDocuments(filter),
  ]);

  const requests = await ServiceRequest.find({
    _id: { $in: quotes.map((quote) => quote.requestId) },
  }).populate([{ path: 'serviceId' }, { path: 'customerId' }]);
  const requestById = new Map(requests.map((request) => [toIdString(request._id), request]));

  return toPageResult(
    'quotes',
    quotes.map((quote) => toAdminQuote(quote, requestById.get(toIdString(quote.requestId)))),
    pagination,
    total,
  );
}

async function findAdminQuoteOrFail(quoteId) {
  const id = parseObjectId(quoteId, 'quoteId');
  const quote = await Quote.findById(id).populate({ path: 'providerId' });

  if (!quote) {
    throw new ApiError(404, 'Quote not found', 'QUOTE_NOT_FOUND');
  }

  return quote;
}

export async function getAdminQuote(quoteId) {
  const quote = await findAdminQuoteOrFail(quoteId);
  const request = await ServiceRequest.findById(quote.requestId).populate([
    { path: 'serviceId' },
    { path: 'customerId' },
  ]);
  const booking = await Booking.findOne({ quoteId: quote.id });

  return {
    quote: toAdminQuote(quote, request),
    booking: booking ? { id: booking.id, status: booking.bookingStatus } : null,
  };
}
