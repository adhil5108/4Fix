import Booking, { BOOKING_STATUSES } from '../models/Booking.js';
import { BOOKING_STATUS_GROUPS } from '../utils/bookingStateMachine.js';
import { OPEN_REQUEST_STATUSES } from '../utils/requestStateMachine.js';
import Review from '../models/Review.js';
import Service from '../models/Service.js';
import ServiceRequest, { REQUEST_STATUSES } from '../models/ServiceRequest.js';
import User, { USER_ROLES } from '../models/User.js';
import { toBookingForCustomer } from './bookingPresenter.service.js';
import { BOOKING_POPULATE } from './booking.service.js';
import { CUSTOMER_POPULATE } from './request.service.js';
import { isPopulated, toCustomerRequest } from './requestPresenter.service.js';
import { toUserSummary } from './userPresenter.service.js';

const RECENT_LIMIT = 5;
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
    acceptedRequests,
    activeBookings,
    completedBookings,
    totalReviews,
    recentRequests,
    recentBookings,
  ] = await Promise.all([
    User.countDocuments({ role: USER_ROLES.CUSTOMER }),
    User.countDocuments({ role: USER_ROLES.PROVIDER }),
    User.countDocuments({ role: USER_ROLES.PROVIDER, isActive: true }),
    Service.countDocuments({}),
    Service.countDocuments({ isActive: true }),
    ServiceRequest.countDocuments({ status: { $in: OPEN_REQUEST_STATUSES } }),
    ServiceRequest.countDocuments({ status: REQUEST_STATUSES.ACCEPTED }),
    Booking.countDocuments({ bookingStatus: { $in: ACTIVE_BOOKING_STATUSES } }),
    Booking.countDocuments({ bookingStatus: BOOKING_STATUSES.COMPLETED }),
    Review.countDocuments({}),
    ServiceRequest.find({})
      .sort({ createdAt: -1 })
      .limit(RECENT_LIMIT)
      .populate([...CUSTOMER_POPULATE, { path: 'customerId' }]),
    Booking.find({}).sort({ createdAt: -1 }).limit(RECENT_LIMIT).populate(BOOKING_POPULATE),
  ]);

  return {
    counts: {
      totalCustomers,
      totalProviders,
      activeProviders,
      totalServices,
      activeServices,
      openRequests,
      acceptedRequests,
      activeBookings,
      completedBookings,
      totalReviews,
    },
    recent: {
      requests: recentRequests.map((request) => ({
        ...toCustomerRequest(request),
        customer: isPopulated(request.customerId) ? toUserSummary(request.customerId) : null,
      })),
      bookings: recentBookings.map(toBookingForCustomer),
    },
  };
}
