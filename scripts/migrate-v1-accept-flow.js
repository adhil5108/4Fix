// One-off migration from the quote-based flow to the V1 provider-accept flow.
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

await requests.updateMany({ acceptedQuoteId: { $exists: true } }, { $unset: { acceptedQuoteId: '' } });
await Booking.collection.updateMany({ quoteId: { $exists: true } }, { $unset: { quoteId: '' } });

// Under the old flow a booking only existed once the customer confirmed; every
// assigned request now needs one.
const assigned = await ServiceRequest.find({
  selectedProviderId: { $ne: null },
  status: {
    $in: [REQUEST_STATUSES.ACCEPTED, REQUEST_STATUSES.SCHEDULED, REQUEST_STATUSES.IN_PROGRESS],
  },
});

for (const request of assigned) {
  await ensureBookingForAcceptedRequest(request);
}

console.log(
  `Reopened ${reopened.modifiedCount}, accepted ${accepted.modifiedCount}, ` +
    `checked bookings for ${assigned.length} assigned request(s).`,
);

await mongoose.disconnect();
