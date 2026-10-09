// The V1 migration against fixtures in its own throwaway database (separate from the API
// suite's, which may run in parallel). Never touches a development or production DB.
const TEST_DATABASE = '4Fix_migrationtest';

process.env.MONGODB_URI = `mongodb://localhost:27017/${TEST_DATABASE}`;
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'migrationtest-only-secret';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';

const { migrateV1AcceptFlow } = await import('../scripts/migrate-v1-accept-flow.js');
const { default: Booking } = await import('../src/models/Booking.js');
const { default: ServiceRequest } = await import('../src/models/ServiceRequest.js');
const { default: ExternalJob } = await import('../src/models/ExternalJob.js');

const id = () => new mongoose.Types.ObjectId();
const at = (iso) => new Date(iso);
const ids = {};

// Raw documents, written straight to the collections exactly as stored data looks.
function request(key, fields) {
  ids[key] = id();
  return {
    _id: ids[key],
    serviceId: id(),
    description: `Fixture ${key}`,
    attachments: [],
    selectedProviderId: null,
    createdAt: at('2026-01-01T09:00:00Z'),
    updatedAt: at('2026-01-02T09:00:00Z'),
    ...fields,
  };
}

function booking(key, requestKey, fields) {
  ids[key] = id();
  return {
    _id: ids[key],
    requestId: ids[requestKey],
    customerId: null,
    providerId: ids.provider,
    confirmedAt: at('2026-01-02T10:00:00Z'),
    technicianStartedAt: null,
    completedAt: null,
    createdAt: at('2026-01-02T10:00:00Z'),
    updatedAt: at('2026-01-02T10:00:00Z'),
    ...fields,
  };
}

async function seed() {
  ids.provider = id();
  const provider = ids.provider;

  await ServiceRequest.collection.insertMany([
    // Pre-V1 statuses.
    request('quoteReceived', { status: 'QUOTE_RECEIVED', selectedProviderId: provider }),
    request('quoteAccepted', { status: 'QUOTE_ACCEPTED', selectedProviderId: provider, acceptedQuoteId: id() }),
    request('scheduled', { status: 'SCHEDULED', selectedProviderId: provider, acceptedAt: at('2026-01-02T08:00:00Z') }),
    request('legacyArrivedReq', { status: 'ACCEPTED', selectedProviderId: provider, acceptedAt: at('2026-01-02T08:00:00Z') }),
    request('legacyInServiceReq', { status: 'IN_PROGRESS', selectedProviderId: provider, acceptedAt: at('2026-01-02T08:00:00Z') }),
    // Already-migrated / current records.
    request('pending', { status: 'PENDING' }),
    request('accepted', { status: 'ACCEPTED', selectedProviderId: provider, acceptedAt: at('2026-01-03T08:00:00Z') }),
    request('reached', {
      status: 'LOCATION_REACHED',
      selectedProviderId: provider,
      acceptedAt: at('2026-01-03T08:00:00Z'),
      locationReachedAt: at('2026-01-03T09:00:00Z'),
    }),
    request('inProgress', { status: 'IN_PROGRESS', selectedProviderId: provider, acceptedAt: at('2026-01-03T08:00:00Z') }),
    request('completed', { status: 'COMPLETED', selectedProviderId: provider, acceptedAt: at('2026-01-03T08:00:00Z') }),
    request('cancelled', { status: 'CANCELLED' }),
    // Assigned requests whose booking is missing (e.g. an interrupted accept).
    request('reachedNoBooking', {
      status: 'LOCATION_REACHED',
      selectedProviderId: provider,
      acceptedAt: at('2026-01-04T08:00:00Z'),
      locationReachedAt: at('2026-01-04T09:00:00Z'),
    }),
    request('inProgressNoBooking', { status: 'IN_PROGRESS', selectedProviderId: provider, acceptedAt: at('2026-01-04T08:00:00Z') }),
  ]);

  await Booking.collection.insertMany([
    booking('bConfirmed', 'scheduled', { bookingStatus: 'CONFIRMED', quoteId: id() }),
    booking('bLegacyArrived', 'legacyArrivedReq', { bookingStatus: 'ARRIVED', lastLocation: { latitude: 1, longitude: 1 } }),
    booking('bLegacyInService', 'legacyInServiceReq', { bookingStatus: 'IN_SERVICE', technicianStartedAt: at('2026-01-02T11:00:00Z') }),
    booking('bAccepted', 'accepted', { bookingStatus: 'ASSIGNED' }),
    booking('bReached', 'reached', { bookingStatus: 'LOCATION_REACHED', locationReachedAt: at('2026-01-03T09:00:00Z') }),
    booking('bInProgress', 'inProgress', {
      bookingStatus: 'IN_PROGRESS',
      locationReachedAt: at('2026-01-03T09:00:00Z'),
      technicianStartedAt: at('2026-01-03T09:30:00Z'),
    }),
    booking('bCompleted', 'completed', {
      bookingStatus: 'COMPLETED',
      technicianStartedAt: at('2026-01-03T09:30:00Z'),
      completedAt: at('2026-01-03T12:00:00Z'),
    }),
    booking('bCancelled', 'cancelled', { bookingStatus: 'CANCELLED' }),
  ]);

  // External jobs share status names (SCHEDULED, ARRIVED) but are a separate lifecycle.
  ids.extScheduled = id();
  ids.extArrived = id();
  await ExternalJob.collection.insertMany([
    { _id: ids.extScheduled, providerId: provider, status: 'SCHEDULED', customerName: 'Walk-in', serviceLabel: 'AC', description: 'x' },
    { _id: ids.extArrived, providerId: provider, status: 'ARRIVED', customerName: 'Walk-in', serviceLabel: 'AC', description: 'x', arrivedAt: at('2026-01-05T09:00:00Z') },
  ]);
}

// Everything a migration could change, keyed and sorted so runs can be compared exactly.
async function snapshot() {
  const sorted = (docs) => JSON.stringify(docs.sort((a, b) => String(a._id).localeCompare(String(b._id))));

  return {
    requests: sorted(await ServiceRequest.collection.find({}).toArray()),
    bookings: sorted(await Booking.collection.find({}).toArray()),
    externalJobs: sorted(await ExternalJob.collection.find({}).toArray()),
  };
}

const requestStatus = async (key) => (await ServiceRequest.collection.findOne({ _id: ids[key] })).status;
const bookingOf = (key) => Booking.collection.findOne({ _id: ids[key] });
const bookingForRequest = (key) => Booking.collection.findOne({ requestId: ids[key] });

let beforeExternal;
let firstRun;
let afterFirst;

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  if (mongoose.connection.name !== TEST_DATABASE) {
    throw new Error(`Refusing to run migration tests against database "${mongoose.connection.name}"`);
  }

  await mongoose.connection.dropDatabase();
  await Booking.syncIndexes();
  await seed();
  beforeExternal = (await snapshot()).externalJobs;
  firstRun = await migrateV1AcceptFlow();
  afterFirst = await snapshot();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('V1 accept-flow migration', () => {
  it('migrates legacy request and booking statuses', async () => {
    assert.equal(await requestStatus('quoteReceived'), 'PENDING');
    assert.equal((await ServiceRequest.collection.findOne({ _id: ids.quoteReceived })).selectedProviderId, null);
    assert.equal(await requestStatus('quoteAccepted'), 'ACCEPTED');
    assert.equal(await requestStatus('scheduled'), 'ACCEPTED');
    assert.equal('acceptedQuoteId' in (await ServiceRequest.collection.findOne({ _id: ids.quoteAccepted })), false);

    assert.equal((await bookingOf('bConfirmed')).bookingStatus, 'ASSIGNED');
    assert.equal((await bookingOf('bLegacyArrived')).bookingStatus, 'ASSIGNED');
    assert.equal((await bookingOf('bLegacyInService')).bookingStatus, 'IN_PROGRESS');
    assert.equal('lastLocation' in (await bookingOf('bLegacyArrived')), false);
    assert.equal('quoteId' in (await bookingOf('bConfirmed')), false);
    // The legacy ARRIVED booking was never at LOCATION_REACHED: no reached time is invented.
    assert.equal((await bookingOf('bLegacyArrived')).locationReachedAt, undefined);
  });

  it('leaves current statuses alone, including LOCATION_REACHED, completed and cancelled jobs', async () => {
    for (const [key, status] of [
      ['pending', 'PENDING'],
      ['accepted', 'ACCEPTED'],
      ['reached', 'LOCATION_REACHED'],
      ['inProgress', 'IN_PROGRESS'],
      ['completed', 'COMPLETED'],
      ['cancelled', 'CANCELLED'],
    ]) {
      assert.equal(await requestStatus(key), status, key);
    }

    for (const [key, status] of [
      ['bAccepted', 'ASSIGNED'],
      ['bReached', 'LOCATION_REACHED'],
      ['bInProgress', 'IN_PROGRESS'],
      ['bCompleted', 'COMPLETED'],
      ['bCancelled', 'CANCELLED'],
    ]) {
      assert.equal((await bookingOf(key)).bookingStatus, status, key);
    }

    const completed = await bookingOf('bCompleted');
    assert.deepEqual(completed.completedAt, at('2026-01-03T12:00:00Z'));
    assert.deepEqual((await bookingOf('bReached')).locationReachedAt, at('2026-01-03T09:00:00Z'));
  });

  it('backfills a missing booking in step with its request, without inventing history', async () => {
    // quoteAccepted, reachedNoBooking and inProgressNoBooking; the others already had one.
    assert.equal(firstRun.createdBookings, 3);

    const reached = await bookingForRequest('reachedNoBooking');
    assert.equal(reached.bookingStatus, 'LOCATION_REACHED', 'never moved back to ASSIGNED');
    assert.deepEqual(reached.confirmedAt, at('2026-01-04T08:00:00Z'), 'confirmedAt comes from acceptedAt');
    assert.deepEqual(reached.locationReachedAt, at('2026-01-04T09:00:00Z'));
    assert.equal(reached.technicianStartedAt, null);

    const inProgress = await bookingForRequest('inProgressNoBooking');
    assert.equal(inProgress.bookingStatus, 'IN_PROGRESS');
    assert.equal(inProgress.locationReachedAt, null, 'no reached time invented');
    assert.equal(inProgress.technicianStartedAt, null, 'no start time invented');

    // Requests that already had a booking keep that exact booking.
    assert.equal(String((await bookingForRequest('reached'))._id), String(ids.bReached));
    // Open, completed and cancelled requests get no booking created.
    assert.equal(await bookingForRequest('pending'), null);
    assert.equal(await bookingForRequest('quoteReceived'), null);
  });

  it('a second run changes nothing and creates no duplicates', async () => {
    const bookingCount = await Booking.countDocuments();
    const secondRun = await migrateV1AcceptFlow();

    assert.deepEqual(
      { ...secondRun, assignedRequests: 0 },
      {
        reopened: 0,
        accepted: 0,
        unscheduled: 0,
        jobsAssigned: 0,
        jobsInProgress: 0,
        assignedRequests: 0,
        createdBookings: 0,
      },
    );
    assert.equal(await Booking.countDocuments(), bookingCount);
    assert.deepEqual(await snapshot(), afterFirst, 'every document is byte-for-byte unchanged');

    // And a third, for good measure.
    await migrateV1AcceptFlow();
    assert.deepEqual(await snapshot(), afterFirst);
  });

  it('never touches external jobs', async () => {
    assert.equal(afterFirst.externalJobs, beforeExternal);
    assert.equal((await ExternalJob.collection.findOne({ _id: ids.extScheduled })).status, 'SCHEDULED');
    assert.equal((await ExternalJob.collection.findOne({ _id: ids.extArrived })).status, 'ARRIVED');
  });
});
