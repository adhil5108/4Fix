import Quote, { ACTIVE_QUOTE_STATUSES, QUOTE_STATUSES } from '../models/Quote.js';
import ServiceRequest from '../models/ServiceRequest.js';
import { USER_ROLES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { isSameId, parseObjectId } from '../utils/objectId.js';
import { QUOTABLE_REQUEST_STATUSES } from '../utils/requestStateMachine.js';
import { toQuoteForCustomer, toQuoteForProvider } from './quotePresenter.service.js';
import {
  acceptQuoteOnRequest,
  assertProviderCanAccessRequest,
  findCustomerRequestOrFail,
  markRequestQuoteReceived,
  presentCustomerRequestById,
} from './request.service.js';

function validateAmount(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, 'Amount must be a positive number', 'VALIDATION_ERROR');
  }

  if (amount > 10000000) {
    throw new ApiError(400, 'Amount must be 10000000 or less', 'VALIDATION_ERROR');
  }

  return Math.round(amount * 100) / 100;
}

function validateDescription(description) {
  const trimmed = typeof description === 'string' ? description.trim() : '';

  if (trimmed.length < 3) {
    throw new ApiError(400, 'Description must be at least 3 characters', 'VALIDATION_ERROR');
  }

  if (trimmed.length > 1000) {
    throw new ApiError(400, 'Description must be 1000 characters or fewer', 'VALIDATION_ERROR');
  }

  return trimmed;
}

async function findQuoteOrFail(quoteId) {
  const id = parseObjectId(quoteId, 'quoteId');
  const quote = await Quote.findById(id);

  if (!quote) {
    throw new ApiError(404, 'Quote not found', 'QUOTE_NOT_FOUND');
  }

  return quote;
}

async function findCustomerQuoteOrFail(quoteId, customer) {
  const quote = await findQuoteOrFail(quoteId);
  const request = await ServiceRequest.findById(quote.requestId);

  if (!request) {
    throw new ApiError(404, 'Service request not found', 'REQUEST_NOT_FOUND');
  }

  if (!isSameId(request.customerId, customer.id)) {
    throw new ApiError(403, 'Access denied', 'FORBIDDEN');
  }

  return { quote, request };
}

export async function createQuote(provider, requestId, input) {
  const amount = validateAmount(input?.amount);
  const description = validateDescription(input?.description);
  const id = parseObjectId(requestId, 'requestId');
  const request = await ServiceRequest.findById(id);

  if (!request) {
    throw new ApiError(404, 'Service request not found', 'REQUEST_NOT_FOUND');
  }

  if (!QUOTABLE_REQUEST_STATUSES.includes(request.status)) {
    throw new ApiError(
      409,
      'This service request is no longer accepting quotes',
      'REQUEST_NOT_QUOTABLE',
    );
  }

  const existingQuote = await Quote.findOne({
    requestId: request.id,
    providerId: provider.id,
    status: { $in: ACTIVE_QUOTE_STATUSES },
  });

  if (existingQuote) {
    throw new ApiError(
      409,
      'You already have an active quote for this request',
      'DUPLICATE_QUOTE',
    );
  }

  const quote = await Quote.create({
    requestId: request.id,
    providerId: provider.id,
    amount,
    description,
    status: QUOTE_STATUSES.PENDING,
  });

  await markRequestQuoteReceived(request);

  return {
    quote: toQuoteForProvider(quote),
  };
}

export async function listRequestQuotes(user, requestId) {
  if (user.role === USER_ROLES.CUSTOMER) {
    const request = await findCustomerRequestOrFail(requestId, user);
    const quotes = await Quote.find({ requestId: request.id })
      .sort({ createdAt: -1 })
      .populate({ path: 'providerId' });

    return {
      quotes: quotes.map(toQuoteForCustomer),
    };
  }

  const id = parseObjectId(requestId, 'requestId');
  const request = await ServiceRequest.findById(id);

  if (!request) {
    throw new ApiError(404, 'Service request not found', 'REQUEST_NOT_FOUND');
  }

  await assertProviderCanAccessRequest(request, user);

  // Providers only see their own quotes, never competing providers' pricing.
  const quotes = await Quote.find({ requestId: request.id, providerId: user.id }).sort({
    createdAt: -1,
  });

  return {
    quotes: quotes.map(toQuoteForProvider),
  };
}

export async function acceptQuote(customer, quoteId) {
  const { quote, request } = await findCustomerQuoteOrFail(quoteId, customer);

  if (quote.status !== QUOTE_STATUSES.PENDING) {
    throw new ApiError(409, 'Only a pending quote can be accepted', 'QUOTE_NOT_PENDING');
  }

  await acceptQuoteOnRequest(request, quote, customer);

  await Quote.updateOne(
    { _id: quote.id },
    { $set: { status: QUOTE_STATUSES.ACCEPTED } },
  );

  await Quote.updateMany(
    {
      requestId: request.id,
      _id: { $ne: quote.id },
      status: QUOTE_STATUSES.PENDING,
    },
    { $set: { status: QUOTE_STATUSES.REJECTED } },
  );

  const acceptedQuote = await Quote.findById(quote.id).populate({ path: 'providerId' });

  return {
    request: await presentCustomerRequestById(request.id),
    quote: toQuoteForCustomer(acceptedQuote),
  };
}

export async function rejectQuote(customer, quoteId) {
  const { quote } = await findCustomerQuoteOrFail(quoteId, customer);

  if (quote.status !== QUOTE_STATUSES.PENDING) {
    throw new ApiError(409, 'Only a pending quote can be rejected', 'QUOTE_NOT_PENDING');
  }

  const rejected = await Quote.findOneAndUpdate(
    { _id: quote.id, status: QUOTE_STATUSES.PENDING },
    { $set: { status: QUOTE_STATUSES.REJECTED } },
    { returnDocument: 'after' },
  ).populate({ path: 'providerId' });

  if (!rejected) {
    throw new ApiError(409, 'Quote was updated, please retry', 'QUOTE_CONFLICT');
  }

  return {
    quote: toQuoteForCustomer(rejected),
  };
}
