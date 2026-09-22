import Booking, { BOOKING_STATUSES } from '../models/Booking.js';
import { BOOKING_STATUS_GROUPS } from '../utils/bookingStateMachine.js';
import Payment, { PAYMENT_STATUSES } from '../models/Payment.js';
import Quote, { QUOTE_STATUSES } from '../models/Quote.js';
import Review from '../models/Review.js';
import Service from '../models/Service.js';
import ServiceRequest, { REQUEST_STATUSES } from '../models/ServiceRequest.js';
import User, { USER_ROLES } from '../models/User.js';
import { toAdminQuote } from './adminQuotes.service.js';
import { toBookingForCustomer } from './bookingPresenter.service.js';
import { CUSTOMER_POPULATE } from './request.service.js';
import { isPopulated, toCustomerRequest } from './requestPresenter.service.js';
import { toUserSummary } from './userPresenter.service.js';

const RECENT_LIMIT = 5;
const OPEN_REQUEST_STATUSES = [REQUEST_STATUSES.PENDING, REQUEST_STATUSES.QUOTE_RECEIVED];
const ACTIVE_BOOKING_STATUSES = [
  ...BOOKING_STATUS_GROUPS.UPCOMING,
  ...BOOKING_STATUS_GROUPS.ACTIVE,
];

// A single, server-aggregated snapshot of the marketplace. Every count is a MongoDB
// countDocuments call — nothing is computed by fetching full collections to the API.
export async function getAdminDashboard() {
  const [
    totalCustomers,
    totalProviders,
    activeProviders,
    totalServices,
    activeServices,
    openRequests,
    openQuotes,
    acceptedQuotes,
    activeBookings,
    completedBookings,
    pendingPayments,
    completedPayments,
    totalReviews,
    recentRequests,
    recentQuotes,
    recentBookings,
  ] = await Promise.all([
    User.countDocuments({ role: USER_ROLES.CUSTOMER }),
    User.countDocuments({ role: USER_ROLES.PROVIDER }),
    User.countDocuments({ role: USER_ROLES.PROVIDER, isActive: true }),
    Service.countDocuments({}),
    Service.countDocuments({ isActive: true }),
    ServiceRequest.countDocuments({ status: { $in: OPEN_REQUEST_STATUSES } }),
    Quote.countDocuments({ status: QUOTE_STATUSES.PENDING }),
    Quote.countDocuments({ status: QUOTE_STATUSES.ACCEPTED }),
    Booking.countDocuments({ bookingStatus: { $in: ACTIVE_BOOKING_STATUSES } }),
    Booking.countDocuments({ bookingStatus: BOOKING_STATUSES.COMPLETED }),
    Payment.countDocuments({ status: PAYMENT_STATUSES.PENDING }),
    Payment.countDocuments({ status: PAYMENT_STATUSES.PAID }),
    Review.countDocuments({}),
    ServiceRequest.find({})
      .sort({ createdAt: -1 })
      .limit(RECENT_LIMIT)
      .populate([...CUSTOMER_POPULATE, { path: 'customerId' }]),
    Quote.find({}).sort({ createdAt: -1 }).limit(RECENT_LIMIT).populate({ path: 'providerId' }),
    Booking.find({})
      .sort({ createdAt: -1 })
      .limit(RECENT_LIMIT)
      .populate([
        { path: 'requestId', populate: { path: 'serviceId' } },
        { path: 'quoteId' },
        { path: 'providerId' },
        { path: 'customerId' },
      ]),
  ]);

  // Recent quotes additionally show which request/service/customer they belong to.
  const quoteRequests = await ServiceRequest.find({
    _id: { $in: recentQuotes.map((quote) => quote.requestId) },
  }).populate([{ path: 'serviceId' }, { path: 'customerId' }]);
  const quoteRequestById = new Map(quoteRequests.map((request) => [String(request._id), request]));

  return {
    counts: {
      totalCustomers,
      totalProviders,
      activeProviders,
      totalServices,
      activeServices,
      openRequests,
      openQuotes,
      acceptedQuotes,
      activeBookings,
      completedBookings,
      pendingPayments,
      completedPayments,
      totalReviews,
    },
    recent: {
      requests: recentRequests.map((request) => ({
        ...toCustomerRequest(request),
        customer: isPopulated(request.customerId) ? toUserSummary(request.customerId) : null,
      })),
      quotes: recentQuotes.map((quote) => toAdminQuote(quote, quoteRequestById.get(String(quote.requestId)))),
      bookings: recentBookings.map(toBookingForCustomer),
    },
  };
}
