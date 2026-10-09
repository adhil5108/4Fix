// One-off migration to the V1 model: provider-accept flow (no quotes/payments) and the
// job lifecycle ASSIGNED → LOCATION_REACHED → IN_PROGRESS → COMPLETED (no scheduling or
// live travel tracking, no provider live location). Nothing is deleted except stored
// provider live positions. Legacy customer accounts/fields are left untouched.
// Usage: npm run migrate:v1   (reads MONGODB_URI from .env; safe to run repeatedly)
//
// Idempotent: every status rewrite below matches only pre-V1 values (QUOTE_*, SCHEDULED
// on requests; CONFIRMED/ON_THE_WAY/ARRIVED/IN_SERVICE on bookings) that the current
// schemas cannot hold, so a second run matches nothing. Current statuses — including
// LOCATION_REACHED, which is deliberately not named ARRIVED — are never rewritten.
// Only the `servicerequests` and `bookings` collections are touched; external jobs (with
// their own SCHEDULED/ARRIVED statuses) live in a separate collection.
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import Booking, { BOOKING_STATUSES } from '../src/models/Booking.js';
import ServiceRequest, { REQUEST_STATUSES } from '../src/models/ServiceRequest.js';

// The booking status matching each assigned-request status, for backfilled bookings.
const BOOKING_STATUS_FOR_REQUEST = {
  [REQUEST_STATUSES.ACCEPTED]: BOOKING_STATUSES.ASSIGNED,
  [REQUEST_STATUSES.LOCATION_REACHED]: BOOKING_STATUSES.LOCATION_REACHED,
  [REQUEST_STATUSES.IN_PROGRESS]: BOOKING_STATUSES.IN_PROGRESS,
};

// Creates the booking an assigned request is missing, in step with the request so the
// job never moves backwards. Existing bookings are never modified. Timestamps are only
// copied from the request, never made up — except `confirmedAt`, which the schema
// requires: a request with no `acceptedAt` gets the time of the backfill (as before).
async function backfillBooking(request) {
  if (await Booking.exists({ requestId: request._id })) {
    return false;
  }

  try {
    await Booking.create({
      requestId: request._id,
      customerId: request.customerId ?? null,
      providerId: request.selectedProviderId,
      bookingStatus: BOOKING_STATUS_FOR_REQUEST[request.status],
      confirmedAt: request.acceptedAt ?? new Date(),
      locationReachedAt: request.locationReachedAt ?? null,
    });
    return true;
  } catch (error) {
    // A concurrent accept created it first (unique requestId): nothing to do.
    if (error?.code === 11000) {
      return false;
    }

    throw error;
  }
}

export async function migrateV1AcceptFlow() {
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

  // Legacy booking travel/arrival steps collapse into ASSIGNED (the provider then marks
  // Location Reached in the app); the old "in service" is IN_PROGRESS.
  const bookings = Booking.collection;
  const assignedJobs = await bookings.updateMany(
    { bookingStatus: { $in: ['CONFIRMED', 'ON_THE_WAY', 'ARRIVED'] } },
    { $set: { bookingStatus: BOOKING_STATUSES.ASSIGNED } },
  );
  const startedJobs = await bookings.updateMany(
    { bookingStatus: 'IN_SERVICE' },
    { $set: { bookingStatus: BOOKING_STATUSES.IN_PROGRESS } },
  );
  // Providers no longer share a live position; drop any that was stored.
  await bookings.updateMany({ lastLocation: { $exists: true } }, { $unset: { lastLocation: '' } });
  await bookings.updateMany({ quoteId: { $exists: true } }, { $unset: { quoteId: '' } });

  // Under the old flow a booking only existed once the customer confirmed; every
  // assigned request now needs one.
  const assigned = await ServiceRequest.find({
    selectedProviderId: { $ne: null },
    status: { $in: Object.keys(BOOKING_STATUS_FOR_REQUEST) },
  });
  let createdBookings = 0;

  for (const request of assigned) {
    if (await backfillBooking(request)) {
      createdBookings += 1;
    }
  }

  return {
    reopened: reopened.modifiedCount,
    accepted: accepted.modifiedCount,
    unscheduled: unscheduled.modifiedCount,
    jobsAssigned: assignedJobs.modifiedCount,
    jobsInProgress: startedJobs.modifiedCount,
    assignedRequests: assigned.length,
    createdBookings,
  };
}

// Run only when executed directly (`npm run migrate:v1`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { env } = await import('../src/config/env.js');

  await mongoose.connect(env.mongodbUri);

  const result = await migrateV1AcceptFlow();

  console.log(
    `Reopened ${result.reopened}, accepted ${result.accepted}, ` +
      `unscheduled ${result.unscheduled}, jobs → ASSIGNED ${result.jobsAssigned}, ` +
      `jobs → IN_PROGRESS ${result.jobsInProgress}, ` +
      `created ${result.createdBookings} missing booking(s) for ${result.assignedRequests} assigned request(s).`,
  );

  await mongoose.disconnect();
}
