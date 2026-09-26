// One-off migration to the V1 model: provider-accept flow (no quotes/payments) and the
// simplified job lifecycle ASSIGNED → IN_PROGRESS → COMPLETED (no scheduling, travel or
// arrival steps, no provider live location). Nothing is deleted except stored provider
// live positions. Legacy customer accounts/fields are left untouched.
// Usage: npm run migrate:v1   (reads MONGODB_URI from .env; safe to run repeatedly)
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import Booking from '../src/models/Booking.js';
import ServiceRequest, { REQUEST_STATUSES } from '../src/models/ServiceRequest.js';
import { ensureBookingForAcceptedRequest } from '../src/services/booking.service.js';

await mongoose.connect(env.mongodbUri);

const requests = ServiceRequest.collection;

// Quoted but not yet awarded → open again for providers to accept.
const reopened = await requests.updateMany(
  { status: 'QUOTE_RECEIVED' },
  { $set: { status: REQUEST_STATUSES.PENDING, selectedProviderId: null } },
);

// Awarded via a quote → accepted by that provider.
const accepted = await requests.updateMany({ status: 'QUOTE_ACCEPTED' }, [
  { $set: { status: REQUEST_STATUSES.ACCEPTED, acceptedAt: '$updatedAt' } },
]);

// Scheduling is no longer a step: a scheduled job is simply an accepted one.
const unscheduled = await requests.updateMany(
  { status: 'SCHEDULED' },
  { $set: { status: REQUEST_STATUSES.ACCEPTED } },
);

await requests.updateMany({ acceptedQuoteId: { $exists: true } }, { $unset: { acceptedQuoteId: '' } });

// Booking travel/arrival steps collapse into ASSIGNED; the old "in service" is IN_PROGRESS.
const bookings = Booking.collection;
const assignedJobs = await bookings.updateMany(
  { bookingStatus: { $in: ['CONFIRMED', 'ON_THE_WAY', 'ARRIVED'] } },
  { $set: { bookingStatus: 'ASSIGNED' } },
);
const startedJobs = await bookings.updateMany(
  { bookingStatus: 'IN_SERVICE' },
  { $set: { bookingStatus: 'IN_PROGRESS' } },
);
// Providers no longer share a live position; drop any that was stored.
await bookings.updateMany({ lastLocation: { $exists: true } }, { $unset: { lastLocation: '' } });
await Booking.collection.updateMany({ quoteId: { $exists: true } }, { $unset: { quoteId: '' } });

// Under the old flow a booking only existed once the customer confirmed; every
// assigned request now needs one.
const assigned = await ServiceRequest.find({
  selectedProviderId: { $ne: null },
  status: {
    $in: [REQUEST_STATUSES.ACCEPTED, REQUEST_STATUSES.IN_PROGRESS],
  },
});

for (const request of assigned) {
  await ensureBookingForAcceptedRequest(request);
}

console.log(
  `Reopened ${reopened.modifiedCount}, accepted ${accepted.modifiedCount}, ` +
    `unscheduled ${unscheduled.modifiedCount}, jobs → ASSIGNED ${assignedJobs.modifiedCount}, ` +
    `jobs → IN_PROGRESS ${startedJobs.modifiedCount}, ` +
    `checked bookings for ${assigned.length} assigned request(s).`,
);

await mongoose.disconnect();
