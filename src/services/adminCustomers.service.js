import { BOOKING_POPULATE } from './booking.service.js';
import Booking from '../models/Booking.js';
import Review from '../models/Review.js';
import ServiceRequest from '../models/ServiceRequest.js';
import User, { USER_ROLES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { parseObjectId } from '../utils/objectId.js';
import { parsePagination, toPageResult } from '../utils/pagination.js';
import { escapeRegex } from '../utils/text.js';
import { toBookingForCustomer } from './bookingPresenter.service.js';
import { toCustomerRequest } from './requestPresenter.service.js';
import { toReview } from './reviewPresenter.service.js';
import { toSafeUser } from './userPresenter.service.js';

const RECENT_LIMIT = 20;

export async function listAdminCustomers(query) {
  const pagination = parsePagination(query);
  const filter = { role: USER_ROLES.CUSTOMER };

  if (query?.isActive === 'true') {
    filter.isActive = true;
  } else if (query?.isActive === 'false') {
    filter.isActive = false;
  }

  if (query?.search) {
    const pattern = new RegExp(escapeRegex(String(query.search).trim()), 'i');
    filter.$or = [{ name: pattern }, { username: pattern }];
  }

  const [customers, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.pageSize),
    User.countDocuments(filter),
  ]);

  return toPageResult('customers', customers.map(toSafeUser), pagination, total);
}

export async function findAdminCustomerOrFail(customerId) {
  const id = parseObjectId(customerId, 'customerId');
  const customer = await User.findOne({ _id: id, role: USER_ROLES.CUSTOMER });

  if (!customer) {
    throw new ApiError(404, 'Customer not found', 'CUSTOMER_NOT_FOUND');
  }

  return customer;
}

export async function getAdminCustomer(customerId) {
  const customer = await findAdminCustomerOrFail(customerId);

  const requests = await ServiceRequest.find({ customerId: customer.id })
    .sort({ createdAt: -1 })
    .limit(RECENT_LIMIT)
    .populate([{ path: 'serviceId' }, { path: 'selectedProviderId' }]);

  const [bookings, reviews] = await Promise.all([
    Booking.find({ customerId: customer.id })
      .sort({ createdAt: -1 })
      .limit(RECENT_LIMIT)
      .populate(BOOKING_POPULATE),
    Review.find({ customerId: customer.id }).sort({ createdAt: -1 }).limit(RECENT_LIMIT),
  ]);

  return {
    customer: toSafeUser(customer),
    requests: requests.map((request) => toCustomerRequest(request)),
    bookings: bookings.map(toBookingForCustomer),
    reviews: reviews.map((review) => toReview(review)),
  };
}
