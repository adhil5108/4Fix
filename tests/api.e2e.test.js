import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  api,
  dateOnly,
  del,
  get,
  patch,
  post,
  requestPayload,
  signup,
  startTestServer,
  stopTestServer,
} from './helpers.js';
import cloudinary from '../src/config/cloudinary.js';

// Shared fixtures; suites below run in file order and build on each other.
const ctx = {};
let baseUrl;

async function seedServices() {
  const { default: Service } = await import('../src/models/Service.js');

  const [acRepair, plumbing] = await Service.create([
    {
      name: 'AC Repair',
      description: 'Diagnose and repair air conditioner faults.',
      category: 'AC',
      startingPrice: 499,
      isPopular: true,
      issues: [
        { key: 'NOT_COOLING', label: 'Not cooling', isActive: true },
        { key: 'MAKING_NOISE', label: 'Making noise', isActive: true },
        { key: 'RETIRED', label: 'Retired issue', isActive: false },
      ],
    },
    {
      name: 'Plumbing',
      description: 'Leaks, blocked drains and fittings.',
      category: 'PLUMBING',
      startingPrice: 299,
      isPopular: false,
      issues: [{ key: 'LEAKING_TAP', label: 'Leaking tap', isActive: true }],
    },
    {
      name: 'Retired Service',
      description: 'No longer offered.',
      category: 'LEGACY',
      isActive: false,
    },
  ]);

  ctx.acRepair = acRepair;
  ctx.plumbing = plumbing;
}

async function seedAdmin() {
  const { default: User } = await import('../src/models/User.js');
  const { hashPassword } = await import('../src/services/password.service.js');

  await User.create({
    name: 'Admin',
    username: 'admin',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'ADMIN',
  });

  const login = await post('/api/auth/login', {
    body: { username: 'admin', password: 'AdminPass123' },
  });
  assert.equal(login.status, 200);
  ctx.admin = { token: login.body.accessToken, user: login.body.user };
}

// Drives a request through the full V1 happy path (create → provider accepts →
// schedule → start → complete) and returns its ids. No quote, no payment.
async function runFullFlow({ customer, provider, complete = true }) {
  const created = await post('/api/requests', {
    token: customer.token,
    body: requestPayload(ctx.acRepair.id, { issueKey: 'NOT_COOLING' }),
  });
  assert.equal(created.status, 201);
  const requestId = created.body.request.id;

  const accepted = await post(`/api/requests/${requestId}/accept`, { token: provider.token });
  assert.equal(accepted.status, 200);
  const bookingId = accepted.body.booking.id;

  if (complete) {
    const scheduled = await post(`/api/requests/${requestId}/schedule`, {
      token: provider.token,
      body: { scheduledDate: dateOnly(3), scheduledTime: '11:00' },
    });
    assert.equal(scheduled.status, 200);
    assert.equal((await post(`/api/requests/${requestId}/start`, { token: provider.token })).status, 200);
    assert.equal(
      (await post(`/api/requests/${requestId}/complete`, { token: provider.token })).status,
      200,
    );
  }

  return { requestId, bookingId };
}

before(async () => {
  baseUrl = await startTestServer();
  await seedServices();
  await seedAdmin();

  ctx.customerA = await signup('CUSTOMER', 'Asha Customer', '9876500001');
  ctx.customerB = await signup('CUSTOMER', 'Bala Customer', '9876500002');
  ctx.provider1 = await signup('PROVIDER', 'Prakash Tech', '9876500011');
  ctx.provider2 = await signup('PROVIDER', 'Priya Tech', '9876500012');
});

after(async () => {
  await stopTestServer();
});

describe('services', () => {
  it('lists only active services with catalogue fields', async () => {
    const result = await get('/api/services');

    assert.equal(result.status, 200);
    const names = result.body.services.map((service) => service.name);
    assert.deepEqual(names, ['AC Repair', 'Plumbing']);
    assert.equal(result.body.services[0].startingPrice, 499);
    assert.equal(result.body.services[0].isPopular, true);
    assert.equal('issues' in result.body.services[0], false);
  });

  it('filters by category and popularity', async () => {
    const byCategory = await get('/api/services?category=plumbing');
    assert.equal(byCategory.body.services.length, 1);
    assert.equal(byCategory.body.services[0].category, 'PLUMBING');

    const popular = await get('/api/services?popular=true');
    assert.deepEqual(
      popular.body.services.map((service) => service.name),
      ['AC Repair'],
    );
  });

  it('searches via ?search= and /search?q=', async () => {
    const viaList = await get('/api/services?search=air');
    assert.deepEqual(viaList.body.services.map((service) => service.name), ['AC Repair']);

    const viaSearch = await get('/api/services/search?q=drain');
    assert.equal(viaSearch.status, 200);
    assert.deepEqual(viaSearch.body.services.map((service) => service.name), ['Plumbing']);

    const nothing = await get('/api/services/search?q=zzzz');
    assert.deepEqual(nothing.body.services, []);
  });

  it('returns service details with active issues plus "Something else"', async () => {
    const result = await get(`/api/services/${ctx.acRepair.id}`);

    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.service.issues.map((issue) => issue.key),
      ['NOT_COOLING', 'MAKING_NOISE', 'OTHER'],
    );
  });

  it('hides inactive services', async () => {
    const { default: Service } = await import('../src/models/Service.js');
    const retired = await Service.findOne({ name: 'Retired Service' });
    const result = await get(`/api/services/${retired.id}`);

    assert.equal(result.status, 404);
  });
});

describe('requests', () => {
  it('requires authentication', async () => {
    const result = await post('/api/requests', { body: requestPayload(ctx.acRepair.id) });
    assert.equal(result.status, 401);
  });

  it('rejects issues that do not belong to the service', async () => {
    for (const issueKey of ['NOPE', 'RETIRED', 'LEAKING_TAP']) {
      const result = await post('/api/requests', {
        token: ctx.customerA.token,
        body: requestPayload(ctx.acRepair.id, { issueKey }),
      });
      assert.equal(result.status, 400, issueKey);
    }
  });

  it('creates a request with a selected issue, owned by the caller', async () => {
    const result = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.acRepair.id, {
        issueKey: 'not_cooling',
        customerId: ctx.customerB.user.id,
        status: 'COMPLETED',
      }),
    });

    assert.equal(result.status, 201);
    assert.equal(result.body.request.issueKey, 'NOT_COOLING');
    assert.equal(result.body.request.issueLabel, 'Not cooling');
    assert.equal(result.body.request.status, 'PENDING');
    ctx.requestA = result.body.request;

    const mine = await get('/api/requests', { token: ctx.customerA.token });
    assert.equal(mine.body.requests.length, 1);
    const theirs = await get('/api/requests', { token: ctx.customerB.token });
    assert.equal(theirs.body.requests.length, 0);
  });

  it('accepts "Something else" and requests without an issue', async () => {
    const other = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.acRepair.id, { issueKey: 'OTHER' }),
    });
    assert.equal(other.status, 201);
    assert.equal(other.body.request.issueLabel, 'Something else');
    ctx.requestOther = other.body.request;

    const legacy = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.acRepair.id),
    });
    assert.equal(legacy.status, 201);
    assert.equal(legacy.body.request.issueKey, null);
    ctx.requestLegacy = legacy.body.request;
  });

  it('creates requests with description only, with photos, with voice, and with everything', async () => {
    const photos = [
      'https://res.cloudinary.com/demo/image/upload/v1/4fix/a.png',
      'https://res.cloudinary.com/demo/image/upload/v1/4fix/b.jpg',
    ];
    const voiceNote = {
      url: 'https://res.cloudinary.com/demo/video/upload/v1/4fix/voice-notes/v.webm',
      format: 'webm',
      durationSeconds: 9,
    };
    const location = { latitude: 12.97, longitude: 77.59, address: 'Gate 2' };

    const descriptionOnly = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.acRepair.id),
    });
    assert.equal(descriptionOnly.status, 201);
    assert.deepEqual(descriptionOnly.body.request.attachments, []);
    assert.equal(descriptionOnly.body.request.voiceNote, null);
    assert.equal(descriptionOnly.body.request.status, 'PENDING');
    assert.equal(descriptionOnly.body.request.selectedProviderId, null);
    assert.equal(descriptionOnly.body.request.preferredDate, null);

    const withPhotos = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.acRepair.id, { attachments: photos }),
    });
    assert.equal(withPhotos.status, 201);
    assert.deepEqual(withPhotos.body.request.attachments, photos);

    const withVoice = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.acRepair.id, { voiceNote }),
    });
    assert.equal(withVoice.status, 201);
    assert.deepEqual(withVoice.body.request.voiceNote, voiceNote);

    const everything = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.acRepair.id, {
        address: undefined,
        attachments: photos,
        voiceNote,
        location,
      }),
    });
    assert.equal(everything.status, 201);
    assert.deepEqual(everything.body.request.attachments, photos);
    assert.deepEqual(everything.body.request.voiceNote, voiceNote);
    assert.equal(everything.body.request.location.latitude, 12.97);
    assert.equal(everything.body.request.address, null);

    // These extra requests are cancelled so they stay out of the provider feed below.
    for (const created of [descriptionOnly, withPhotos, withVoice, everything]) {
      assert.equal(
        (await post(`/api/requests/${created.body.request.id}/cancel`, { token: ctx.customerA.token })).status,
        200,
      );
    }
  });

  it('validates input', async () => {
    const missingDescription = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.acRepair.id, { description: '   ' }),
    });
    assert.equal(missingDescription.status, 400);

    const tooShort = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.acRepair.id, { description: 'hot' }),
    });
    assert.equal(tooShort.status, 400);

    const missingService = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(undefined),
    });
    assert.equal(missingService.status, 400);

    const missingAddress = await post('/api/requests', {
      token: ctx.customerA.token,
      body: { ...requestPayload(ctx.acRepair.id), address: undefined },
    });
    assert.equal(missingAddress.status, 400);

    const badPincode = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.acRepair.id, {
        address: { addressLine: '12 Lake View Road', city: 'B', state: 'K', pincode: '12' },
      }),
    });
    assert.equal(badPincode.status, 400);
  });

  it('enforces ownership and cancellation rules', async () => {
    const forbidden = await get(`/api/requests/${ctx.requestA.id}`, { token: ctx.customerB.token });
    assert.equal(forbidden.status, 403);

    const providerCreate = await post('/api/requests', {
      token: ctx.provider1.token,
      body: requestPayload(ctx.acRepair.id),
    });
    assert.equal(providerCreate.status, 403);

    const cancelOther = await post(`/api/requests/${ctx.requestOther.id}/cancel`, {
      token: ctx.customerB.token,
    });
    assert.equal(cancelOther.status, 403);

    const cancelled = await post(`/api/requests/${ctx.requestOther.id}/cancel`, {
      token: ctx.customerA.token,
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.request.status, 'CANCELLED');

    const again = await post(`/api/requests/${ctx.requestOther.id}/cancel`, {
      token: ctx.customerA.token,
    });
    assert.equal(again.status, 409);
  });
});

describe('providers', () => {
  it('serves a public provider profile without private fields', async () => {
    const updated = await patch('/api/users/me', {
      token: ctx.provider1.token,
      body: { bio: 'AC specialist', serviceCategories: ['ac'], experienceYears: 6 },
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.user.serviceCategories, ['AC']);

    const result = await get(`/api/providers/${ctx.provider1.user.id}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.provider.name, 'Prakash Tech');
    assert.equal(result.body.provider.bio, 'AC specialist');
    assert.equal(result.body.provider.experienceYears, 6);
    assert.equal('username' in result.body.provider, false);
    assert.equal('phoneVerifiedAt' in result.body.provider, false);

    const customerProfile = await get(`/api/providers/${ctx.customerA.user.id}`);
    assert.equal(customerProfile.status, 404);
  });

  it('customers cannot set provider profile fields', async () => {
    const result = await patch('/api/users/me', {
      token: ctx.customerA.token,
      body: { name: 'Asha C', bio: 'nope' },
    });
    assert.equal(result.status, 200);
    assert.equal('bio' in result.body.user, false);

    const empty = await patch('/api/users/me', { token: ctx.customerA.token, body: {} });
    assert.equal(empty.status, 400);
  });
});

describe('provider acceptance', () => {
  it('providers see open requests without the customer\'s exact location', async () => {
    const feed = await get('/api/provider/requests', { token: ctx.provider1.token });
    assert.equal(feed.status, 200);
    const listed = feed.body.requests.find((request) => request.id === ctx.requestA.id);
    assert.ok(listed);
    assert.equal(listed.service.name, 'AC Repair');
    assert.equal(listed.description, ctx.requestA.description);
    assert.equal(listed.address.city, 'Bengaluru');
    assert.equal(listed.address.addressLine, null);
    assert.equal('location' in listed, false);
    assert.equal('customer' in listed, false);

    const detail = await get(`/api/provider/requests/${ctx.requestA.id}`, { token: ctx.provider2.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.request.location, null);
    assert.equal(detail.body.request.address.addressLine, null);
    assert.equal(detail.body.request.bookingId, null);

    // Cancelled requests never appear in the feed.
    assert.ok(!feed.body.requests.some((request) => request.id === ctx.requestOther.id));
  });

  it('only providers can accept', async () => {
    assert.equal((await post(`/api/requests/${ctx.requestA.id}/accept`)).status, 401);
    assert.equal(
      (await post(`/api/requests/${ctx.requestA.id}/accept`, { token: ctx.customerA.token })).status,
      403,
    );
    assert.equal(
      (await post(`/api/requests/${ctx.requestA.id}/accept`, { token: ctx.admin.token })).status,
      403,
    );
    assert.equal(
      (await post('/api/requests/64b000000000000000000000/accept', { token: ctx.provider1.token })).status,
      404,
    );
  });

  it('a provider accepts a request and the job is created and assigned to them', async () => {
    const accepted = await post(`/api/requests/${ctx.requestA.id}/accept`, {
      token: ctx.provider1.token,
    });

    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.request.status, 'ACCEPTED');
    assert.equal(accepted.body.request.selectedProviderId, ctx.provider1.user.id);
    assert.ok(accepted.body.request.acceptedAt);
    assert.equal(accepted.body.request.customer.name, 'Asha C');
    assert.equal(accepted.body.request.address.addressLine, '12 Lake View Road');
    assert.equal(accepted.body.booking.status, 'ASSIGNED');
    assert.equal(accepted.body.booking.requestId, ctx.requestA.id);
    assert.equal(accepted.body.booking.customer.name, 'Asha C');
    assert.equal(accepted.body.request.bookingId, accepted.body.booking.id);
    assert.equal('arrivalCode' in accepted.body.booking, false);
    assert.equal('amount' in accepted.body.booking, false);
    assert.equal('quoteId' in accepted.body.booking, false);
    assert.ok(accepted.body.booking.timeline.technicianAssignedAt);
    ctx.bookingA = accepted.body.booking;

    const jobs = await get('/api/provider/jobs', { token: ctx.provider1.token });
    assert.ok(jobs.body.jobs.some((job) => job.id === ctx.requestA.id && job.bookingId === ctx.bookingA.id));

    // The request has left the open marketplace.
    const feed = await get('/api/provider/requests', { token: ctx.provider2.token });
    assert.ok(!feed.body.requests.some((request) => request.id === ctx.requestA.id));
  });

  it('the customer sees the assigned provider and the job', async () => {
    const detail = await get(`/api/requests/${ctx.requestA.id}`, { token: ctx.customerA.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.request.status, 'ACCEPTED');
    assert.equal(detail.body.request.selectedProvider.id, ctx.provider1.user.id);
    assert.equal(detail.body.request.selectedProvider.name, 'Prakash Tech');
    assert.equal(detail.body.request.booking.id, ctx.bookingA.id);
    assert.equal('acceptedQuote' in detail.body.request, false);
    assert.equal('quotesCount' in detail.body.request, false);

    const booking = await get(`/api/bookings/${ctx.bookingA.id}`, { token: ctx.customerA.token });
    assert.equal(booking.status, 200);
    assert.equal(booking.body.booking.provider.id, ctx.provider1.user.id);
    assert.match(booking.body.booking.arrivalCode, /^\d{4}$/);
    ctx.bookingA.arrivalCode = booking.body.booking.arrivalCode;
  });

  it('a second provider gets 409 and the assignment does not change', async () => {
    const late = await post(`/api/requests/${ctx.requestA.id}/accept`, { token: ctx.provider2.token });
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'REQUEST_ALREADY_ACCEPTED');
    assert.equal(late.body.error.message, 'This job has already been accepted.');

    // Unassigned providers can no longer open the request at all.
    const view = await get(`/api/provider/requests/${ctx.requestA.id}`, { token: ctx.provider2.token });
    assert.equal(view.status, 403);

    const detail = await get(`/api/requests/${ctx.requestA.id}`, { token: ctx.customerA.token });
    assert.equal(detail.body.request.selectedProviderId, ctx.provider1.user.id);
  });

  it('repeating the acceptance returns the same job without duplicates', async () => {
    const results = await Promise.all(
      [1, 2, 3].map(() => post(`/api/requests/${ctx.requestA.id}/accept`, { token: ctx.provider1.token })),
    );
    assert.deepEqual(results.map((result) => result.status), [200, 200, 200]);
    assert.ok(results.every((result) => result.body.booking.id === ctx.bookingA.id));

    const { default: Booking } = await import('../src/models/Booking.js');
    assert.equal(await Booking.countDocuments({ requestId: ctx.requestA.id }), 1);
  });

  it('exactly one of two simultaneous acceptances wins; one booking exists', async () => {
    const created = await post('/api/requests', {
      token: ctx.customerB.token,
      body: requestPayload(ctx.acRepair.id, { issueKey: 'MAKING_NOISE' }),
    });
    const requestId = created.body.request.id;

    const results = await Promise.all([
      post(`/api/requests/${requestId}/accept`, { token: ctx.provider1.token }),
      post(`/api/requests/${requestId}/accept`, { token: ctx.provider2.token }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);

    const winner = results.find((result) => result.status === 200);
    const loser = results.find((result) => result.status === 409);
    assert.equal(loser.body.error.code, 'REQUEST_ALREADY_ACCEPTED');

    const detail = await get(`/api/requests/${requestId}`, { token: ctx.customerB.token });
    assert.equal(detail.body.request.selectedProviderId, winner.body.request.selectedProviderId);

    const { default: Booking } = await import('../src/models/Booking.js');
    const bookings = await Booking.find({ requestId });
    assert.equal(bookings.length, 1);
    assert.equal(String(bookings[0].providerId), winner.body.request.selectedProviderId);

    ctx.requestB = requestId;
    ctx.bookingB = winner.body.booking;
    ctx.bookingBProvider = [ctx.provider1, ctx.provider2].find(
      (provider) => provider.user.id === winner.body.request.selectedProviderId,
    );
  });

  it('cancelled requests cannot be accepted, and accepted ones cannot be cancelled', async () => {
    const cancelled = await post(`/api/requests/${ctx.requestOther.id}/accept`, {
      token: ctx.provider1.token,
    });
    assert.equal(cancelled.status, 409);
    assert.equal(cancelled.body.error.code, 'REQUEST_NOT_OPEN');

    const cancelAccepted = await post(`/api/requests/${ctx.requestA.id}/cancel`, {
      token: ctx.customerA.token,
    });
    assert.equal(cancelAccepted.status, 409);
  });

  it('quotes and payments are not part of the flow at all', async () => {
    const { default: mongoose } = await import('mongoose');
    assert.equal(mongoose.modelNames().includes('Quote'), false);
    assert.equal(mongoose.modelNames().includes('Payment'), false);

    const removed = [
      ['POST', `/api/requests/${ctx.requestA.id}/quotes`, ctx.provider1.token],
      ['GET', `/api/requests/${ctx.requestA.id}/quotes`, ctx.customerA.token],
      ['GET', `/api/requests/${ctx.requestA.id}/providers`, ctx.customerA.token],
      ['POST', `/api/requests/${ctx.requestA.id}/confirm`, ctx.customerA.token],
      ['POST', '/api/quotes/64b000000000000000000000/accept', ctx.customerA.token],
      ['POST', `/api/bookings/${ctx.bookingA.id}/assign`, ctx.provider1.token],
      ['GET', `/api/bookings/${ctx.bookingA.id}/payment`, ctx.customerA.token],
      ['POST', `/api/bookings/${ctx.bookingA.id}/payment/mark-paid`, ctx.provider1.token],
      ['GET', '/api/admin/quotes', ctx.admin.token],
      ['GET', '/api/admin/payments', ctx.admin.token],
    ];

    for (const [method, path, token] of removed) {
      assert.equal((await api(method, path, { token })).status, 404, `${method} ${path}`);
    }
  });
});

describe('bookings', () => {
  it('lists only the caller\'s bookings, by role', async () => {
    const mine = await get('/api/bookings', { token: ctx.customerA.token });
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.bookings.map((booking) => booking.id), [ctx.bookingA.id]);
    assert.equal(mine.body.bookings[0].service.name, 'AC Repair');
    assert.equal(mine.body.bookings[0].request.issueLabel, 'Not cooling');
    assert.equal(mine.body.bookings[0].provider.name, 'Prakash Tech');

    const providerView = await get('/api/bookings', { token: ctx.provider1.token });
    const ownBooking = providerView.body.bookings.find((booking) => booking.id === ctx.bookingA.id);
    assert.ok(ownBooking);
    assert.equal('arrivalCode' in ownBooking, false);
    assert.equal(ownBooking.customer.name, 'Asha C');
    assert.ok(providerView.body.bookings.every((booking) => booking.customer));

    const other = await get('/api/bookings', { token: ctx.provider2.token });
    assert.ok(!other.body.bookings.some((booking) => booking.id === ctx.bookingA.id));

    // Admin is allowed onto this endpoint (for the Customer View area preview) but
    // the filter falls back to { customerId: admin.id }, so it never sees this or
    // any other real booking — covered in depth in 'admin area preview' below.
    const admin = await get('/api/bookings', { token: ctx.admin.token });
    assert.equal(admin.status, 200);
    assert.deepEqual(admin.body.bookings, []);
  });

  it('supports group and exact status filters', async () => {
    const upcoming = await get('/api/bookings?status=UPCOMING', { token: ctx.customerA.token });
    assert.equal(upcoming.body.bookings.length, 1);
    const completed = await get('/api/bookings?status=COMPLETED', { token: ctx.customerA.token });
    assert.equal(completed.body.bookings.length, 0);
    const exact = await get('/api/bookings?status=assigned', { token: ctx.customerA.token });
    assert.equal(exact.body.bookings.length, 1);
    const invalid = await get('/api/bookings?status=WHATEVER', { token: ctx.customerA.token });
    assert.equal(invalid.status, 400);
  });

  it('returns a booking to its customer, provider and admin only', async () => {
    const asCustomer = await get(`/api/bookings/${ctx.bookingA.id}`, { token: ctx.customerA.token });
    assert.equal(asCustomer.status, 200);
    assert.equal(asCustomer.body.booking.arrivalCode, ctx.bookingA.arrivalCode);

    const asProvider = await get(`/api/bookings/${ctx.bookingA.id}`, { token: ctx.provider1.token });
    assert.equal(asProvider.status, 200);
    assert.equal(asProvider.body.booking.request.address.pincode, '560001');
    assert.equal('arrivalCode' in asProvider.body.booking, false);

    assert.equal((await get(`/api/bookings/${ctx.bookingA.id}`, { token: ctx.admin.token })).status, 200);
    assert.equal((await get(`/api/bookings/${ctx.bookingA.id}`, { token: ctx.customerB.token })).status, 403);
    assert.equal((await get(`/api/bookings/${ctx.bookingA.id}`, { token: ctx.provider2.token })).status, 403);
    assert.equal((await get(`/api/bookings/${ctx.bookingA.id}`)).status, 401);
    assert.equal((await get('/api/bookings/not-an-id', { token: ctx.customerA.token })).status, 400);
    assert.equal(
      (await get('/api/bookings/64b000000000000000000000', { token: ctx.customerA.token })).status,
      404,
    );
  });

  it('shows the job in the assigned provider\'s jobs list only', async () => {
    const jobs = await get('/api/provider/jobs', { token: ctx.provider1.token });
    assert.equal(jobs.status, 200);
    const job = jobs.body.jobs.find((item) => item.id === ctx.requestA.id);
    assert.ok(job);
    assert.equal(job.bookingId, ctx.bookingA.id);
    assert.equal(job.bookingStatus, 'ASSIGNED');
    assert.equal('amount' in job, false);
    assert.equal(job.issueLabel, 'Not cooling');
    assert.equal(job.address.city, 'Bengaluru');

    const filtered = await get('/api/provider/jobs?bookingStatus=ON_THE_WAY', {
      token: ctx.provider1.token,
    });
    assert.equal(filtered.body.jobs.length, 0);

    const none = await get('/api/provider/jobs', { token: ctx.provider2.token });
    assert.ok(!none.body.jobs.some((item) => item.id === ctx.requestA.id));

    assert.equal((await get('/api/provider/jobs', { token: ctx.customerA.token })).status, 403);
  });
});

describe('tracking', () => {
  const path = (suffix) => `/api/bookings/${ctx.bookingA.id}${suffix}`;

  it('only the assigned provider can update tracking', async () => {
    assert.equal((await post(path('/on-the-way'), { token: ctx.customerA.token })).status, 403);
    assert.equal((await post(path('/on-the-way'), { token: ctx.provider2.token })).status, 403);
    assert.equal((await post(path('/on-the-way'))).status, 401);
  });

  it('rejects invalid transitions', async () => {
    const result = await post(path('/arrived'), { token: ctx.provider1.token });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'INVALID_STATE_TRANSITION');
  });

  it('validates location and stores only the latest point', async () => {
    const bad = await patch(path('/location'), {
      token: ctx.provider1.token,
      body: { latitude: 100, longitude: 77.5 },
    });
    assert.equal(bad.status, 400);
    const badLng = await patch(path('/location'), {
      token: ctx.provider1.token,
      body: { latitude: 12.9, longitude: -190 },
    });
    assert.equal(badLng.status, 400);
    const notNumber = await patch(path('/location'), {
      token: ctx.provider1.token,
      body: { latitude: '12.9', longitude: 77.5 },
    });
    assert.equal(notNumber.status, 400);

    const ok = await patch(path('/location'), {
      token: ctx.provider1.token,
      body: { latitude: 12.97, longitude: 77.59 },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.tracking.lastLocation.latitude, 12.97);

    assert.equal(
      (await patch(path('/location'), { token: ctx.customerA.token, body: { latitude: 1, longitude: 1 } })).status,
      403,
    );
  });

  it('customer reads tracking without invented ETA or distance', async () => {
    const result = await get(path('/tracking'), { token: ctx.customerA.token });
    assert.equal(result.status, 200);
    assert.equal(result.body.tracking.status, 'ASSIGNED');
    assert.equal(result.body.tracking.eta, null);
    assert.equal(result.body.tracking.distance, null);
    assert.equal(result.body.tracking.lastLocation.longitude, 77.59);
    assert.equal(result.body.tracking.provider.name, 'Prakash Tech');

    assert.equal((await get(path('/tracking'), { token: ctx.customerB.token })).status, 403);
  });

  it('walks assigned → on the way → arrived once each', async () => {
    const onTheWay = await post(path('/on-the-way'), { token: ctx.provider1.token });
    assert.equal(onTheWay.body.booking.status, 'ON_THE_WAY');
    assert.equal((await post(path('/on-the-way'), { token: ctx.provider1.token })).status, 409);

    const arrived = await post(path('/arrived'), { token: ctx.provider1.token });
    assert.equal(arrived.body.booking.status, 'ARRIVED');

    const jobs = await get('/api/provider/jobs?bookingStatus=ARRIVED', { token: ctx.provider1.token });
    assert.equal(jobs.body.jobs.length, 1);
  });

  it('follows the request lifecycle into IN_SERVICE', async () => {
    const scheduled = await post(`/api/requests/${ctx.requestA.id}/schedule`, {
      token: ctx.provider1.token,
      body: { scheduledDate: dateOnly(3), scheduledTime: '09:00' },
    });
    assert.equal(scheduled.status, 200);
    const afterSchedule = await get(path(''), { token: ctx.customerA.token });
    assert.equal(afterSchedule.body.booking.scheduledDate, dateOnly(3));
    assert.equal(afterSchedule.body.booking.scheduledTime, '09:00');
    assert.equal(afterSchedule.body.booking.requestStatus, 'SCHEDULED');

    const started = await post(`/api/requests/${ctx.requestA.id}/start`, { token: ctx.provider1.token });
    assert.equal(started.status, 200);
    const tracking = await get(path('/tracking'), { token: ctx.customerA.token });
    assert.equal(tracking.body.tracking.status, 'IN_SERVICE');
    assert.ok(tracking.body.tracking.timeline.technicianStartedAt);
  });
});

describe('chat', () => {
  const path = (suffix) => `/api/bookings/${ctx.bookingA.id}${suffix}`;

  it('is only reachable by the two participants', async () => {
    assert.equal((await post(path('/chat'), { token: ctx.customerB.token })).status, 403);
    assert.equal((await post(path('/chat'), { token: ctx.provider2.token })).status, 403);
    assert.equal((await post(path('/chat'))).status, 401);
    assert.equal(
      (await post(path('/messages'), { token: ctx.customerB.token, body: { message: 'hi' } })).status,
      403,
    );
    assert.equal((await get(path('/messages'), { token: ctx.provider2.token })).status, 403);
  });

  it('creates one conversation shared by both sides', async () => {
    const notYet = await get(path('/chat'), { token: ctx.customerA.token });
    assert.equal(notYet.status, 404);

    const opened = await post(path('/chat'), { token: ctx.customerA.token });
    assert.equal(opened.status, 200);
    assert.equal(opened.body.conversation.bookingId, ctx.bookingA.id);
    assert.equal(opened.body.conversation.unreadCount, 0);

    const providerSide = await post(path('/chat'), { token: ctx.provider1.token });
    assert.equal(providerSide.body.conversation.id, opened.body.conversation.id);
    assert.equal((await get(path('/chat'), { token: ctx.provider1.token })).status, 200);
  });

  it('sends, lists and marks messages read', async () => {
    const empty = await post(path('/messages'), { token: ctx.customerA.token, body: { message: '  ' } });
    assert.equal(empty.status, 400);

    const sent = await post(path('/messages'), {
      token: ctx.customerA.token,
      body: { message: 'Please call when you reach the gate.' },
    });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.message.isMine, true);
    assert.equal(sent.body.message.readAt, null);

    const reply = await post(path('/messages'), {
      token: ctx.provider1.token,
      body: { message: 'Will do, 10 minutes away.' },
    });
    assert.equal(reply.status, 201);

    const providerList = await get(path('/messages'), { token: ctx.provider1.token });
    assert.equal(providerList.body.messages.length, 2);
    assert.equal(providerList.body.messages[0].isMine, false);
    assert.equal(providerList.body.messages[1].isMine, true);

    const unread = await get(path('/chat'), { token: ctx.provider1.token });
    assert.equal(unread.body.conversation.unreadCount, 1);

    const read = await post(path('/messages/read'), { token: ctx.provider1.token });
    assert.equal(read.body.updatedCount, 1);

    const customerList = await get(path('/messages'), { token: ctx.customerA.token });
    assert.ok(customerList.body.messages[0].readAt);
    assert.equal(customerList.body.messages[1].readAt, null);

    const since = await get(
      path(`/messages?since=${encodeURIComponent(customerList.body.messages[0].createdAt)}`),
      { token: ctx.customerA.token },
    );
    assert.equal(since.body.messages.length, 1);
  });
});

describe('provider job notes', () => {
  const path = (suffix) => `/api/bookings/${ctx.bookingA.id}${suffix}`;

  it('rejects access from anyone but the assigned provider', async () => {
    assert.equal((await get(path('/notes'))).status, 401);
    assert.equal((await post(path('/notes'), { body: { content: 'x' } })).status, 401);

    assert.equal((await get(path('/notes'), { token: ctx.customerA.token })).status, 403);
    assert.equal(
      (await post(path('/notes'), { token: ctx.customerA.token, body: { content: 'x' } })).status,
      403,
    );
    assert.equal((await get(path('/notes'), { token: ctx.admin.token })).status, 403);
    assert.equal(
      (await post(path('/notes'), { token: ctx.admin.token, body: { content: 'x' } })).status,
      403,
    );
    assert.equal((await get(path('/notes'), { token: ctx.provider2.token })).status, 403);
    assert.equal(
      (await post(path('/notes'), { token: ctx.provider2.token, body: { content: 'x' } })).status,
      403,
    );
  });

  it('rejects empty notes and notes over the length limit', async () => {
    const empty = await post(path('/notes'), { token: ctx.provider1.token, body: { content: '   ' } });
    assert.equal(empty.status, 400);

    const tooLong = await post(path('/notes'), {
      token: ctx.provider1.token,
      body: { content: 'a'.repeat(2001) },
    });
    assert.equal(tooLong.status, 400);
  });

  it('lets the assigned provider add, list, edit and delete their own notes', async () => {
    const first = await post(path('/notes'), {
      token: ctx.provider1.token,
      body: { content: 'Replaced capacitor and checked outdoor unit.' },
    });
    assert.equal(first.status, 201);
    assert.equal(first.body.note.content, 'Replaced capacitor and checked outdoor unit.');
    assert.equal(first.body.note.jobId, ctx.bookingA.id);

    const second = await post(path('/notes'), {
      token: ctx.provider1.token,
      body: { content: 'Customer requested follow-up next month.' },
    });
    assert.equal(second.status, 201);

    const list = await get(path('/notes'), { token: ctx.provider1.token });
    assert.equal(list.status, 200);
    assert.equal(list.body.notes.length, 2);
    // Newest/most-recently-updated first.
    assert.equal(list.body.notes[0].id, second.body.note.id);
    assert.equal(list.body.notes[1].id, first.body.note.id);

    const noteId = second.body.note.id;
    const edited = await patch(path(`/notes/${noteId}`), {
      token: ctx.provider1.token,
      body: { content: 'Customer requested follow-up in two weeks.' },
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.note.content, 'Customer requested follow-up in two weeks.');

    const afterEdit = await get(path('/notes'), { token: ctx.provider1.token });
    assert.equal(afterEdit.body.notes[0].id, noteId);
    assert.equal(afterEdit.body.notes[0].content, 'Customer requested follow-up in two weeks.');

    const deleted = await del(path(`/notes/${noteId}`), { token: ctx.provider1.token });
    assert.equal(deleted.status, 200);

    const afterDelete = await get(path('/notes'), { token: ctx.provider1.token });
    assert.equal(afterDelete.body.notes.length, 1);
    assert.equal(afterDelete.body.notes[0].id, first.body.note.id);
  });

  it('never lets another provider or the customer edit or delete a note on this job', async () => {
    const own = await post(path('/notes'), {
      token: ctx.provider1.token,
      body: { content: 'Note for ownership checks.' },
    });
    const ownId = own.body.note.id;

    assert.equal(
      (
        await patch(path(`/notes/${ownId}`), {
          token: ctx.provider2.token,
          body: { content: 'hijacked' },
        })
      ).status,
      403,
    );
    assert.equal((await del(path(`/notes/${ownId}`), { token: ctx.provider2.token })).status, 403);
    assert.equal(
      (
        await patch(path(`/notes/${ownId}`), {
          token: ctx.customerA.token,
          body: { content: 'hijacked' },
        })
      ).status,
      403,
    );
    assert.equal((await del(path(`/notes/${ownId}`), { token: ctx.customerA.token })).status, 403);
  });

  it('never surfaces provider notes through the booking responses customers and admin see', async () => {
    const customerView = await get(path(''), { token: ctx.customerA.token });
    assert.equal(customerView.status, 200);
    assert.equal('notes' in customerView.body.booking, false);

    const adminView = await get(path(''), { token: ctx.admin.token });
    assert.equal(adminView.status, 200);
    assert.equal('notes' in adminView.body.booking, false);
  });
});

describe('external jobs', () => {
  const path = (suffix = '') => `/api/provider/external-jobs${suffix}`;

  function payload(overrides = {}) {
    return {
      customerName: 'Walk-in Customer',
      customerPhone: '9998887777',
      serviceLabel: 'AC gas refill',
      description: 'Customer called directly, AC not cooling.',
      address: {
        addressLine: '7 Direct Lane',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560002',
      },
      scheduledDate: dateOnly(1),
      scheduledTime: '14:00',
      ...overrides,
    };
  }

  it('requires authentication and the PROVIDER role', async () => {
    assert.equal((await post(path(), { body: payload() })).status, 401);
    assert.equal((await post(path(), { token: ctx.customerA.token, body: payload() })).status, 403);
    assert.equal((await post(path(), { token: ctx.admin.token, body: payload() })).status, 403);
  });

  it('validates required fields', async () => {
    assert.equal(
      (await post(path(), { token: ctx.provider1.token, body: payload({ customerName: '' }) })).status,
      400,
    );
    assert.equal(
      (await post(path(), { token: ctx.provider1.token, body: payload({ serviceLabel: '' }) })).status,
      400,
    );
    assert.equal(
      (await post(path(), { token: ctx.provider1.token, body: payload({ description: '' }) })).status,
      400,
    );

    const base = payload();
    assert.equal(
      (
        await post(path(), {
          token: ctx.provider1.token,
          body: payload({ address: { ...base.address, addressLine: '' } }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post(path(), {
          token: ctx.provider1.token,
          body: payload({ address: { ...base.address, pincode: '123' } }),
        })
      ).status,
      400,
    );
  });

  it('does not create a ServiceRequest or Booking', async () => {
    const { default: ServiceRequest } = await import('../src/models/ServiceRequest.js');
    const { default: Booking } = await import('../src/models/Booking.js');

    const [beforeRequests, beforeBookings] = await Promise.all([
      ServiceRequest.countDocuments(),
      Booking.countDocuments(),
    ]);

    const created = await post(path(), { token: ctx.provider1.token, body: payload() });
    assert.equal(created.status, 201);
    assert.equal(created.body.job.source, 'EXTERNAL');
    assert.equal(created.body.job.status, 'SCHEDULED');
    assert.equal(created.body.job.customer.name, 'Walk-in Customer');
    ctx.externalJobId = created.body.job.id;

    const [afterRequests, afterBookings] = await Promise.all([
      ServiceRequest.countDocuments(),
      Booking.countDocuments(),
    ]);

    assert.equal(afterRequests, beforeRequests);
    assert.equal(afterBookings, beforeBookings);
  });

  it('provider sees their own external job in My Jobs, alongside 4Fix jobs', async () => {
    const jobs = await get('/api/provider/jobs', { token: ctx.provider1.token });
    assert.equal(jobs.status, 200);

    const external = jobs.body.jobs.find((job) => job.id === ctx.externalJobId);
    assert.ok(external);
    assert.equal(external.source, 'EXTERNAL');

    const fourFix = jobs.body.jobs.find((job) => job.id === ctx.requestA.id);
    assert.ok(fourFix);
    assert.equal(fourFix.source, '4FIX');
  });

  it('provider can read, update and walk the lifecycle of their own external job', async () => {
    const fetched = await get(path(`/${ctx.externalJobId}`), { token: ctx.provider1.token });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.job.customer.name, 'Walk-in Customer');

    const updated = await patch(path(`/${ctx.externalJobId}`), {
      token: ctx.provider1.token,
      body: payload({ customerName: 'Renamed Customer' }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.job.customer.name, 'Renamed Customer');

    assert.equal(
      (await post(path(`/${ctx.externalJobId}/complete`), { token: ctx.provider1.token })).status,
      409,
    );

    const onTheWay = await post(path(`/${ctx.externalJobId}/on-the-way`), { token: ctx.provider1.token });
    assert.equal(onTheWay.status, 200);
    assert.equal(onTheWay.body.job.status, 'ON_THE_WAY');

    const arrived = await post(path(`/${ctx.externalJobId}/arrived`), { token: ctx.provider1.token });
    assert.equal(arrived.body.job.status, 'ARRIVED');

    const started = await post(path(`/${ctx.externalJobId}/start`), { token: ctx.provider1.token });
    assert.equal(started.body.job.status, 'IN_PROGRESS');

    const completed = await post(path(`/${ctx.externalJobId}/complete`), { token: ctx.provider1.token });
    assert.equal(completed.body.job.status, 'COMPLETED');
  });

  it('never lets another provider or a customer access, update or delete this job', async () => {
    assert.equal((await get(path(`/${ctx.externalJobId}`), { token: ctx.provider2.token })).status, 404);
    assert.equal(
      (await patch(path(`/${ctx.externalJobId}`), { token: ctx.provider2.token, body: payload() })).status,
      404,
    );
    assert.equal((await del(path(`/${ctx.externalJobId}`), { token: ctx.provider2.token })).status, 404);
    assert.equal((await get(path(`/${ctx.externalJobId}`), { token: ctx.customerA.token })).status, 403);
    assert.equal((await get(path(`/${ctx.externalJobId}`))).status, 401);
  });

  it('keeps private notes attached to the external job itself, not a separate resource', async () => {
    const note = await post(path(`/${ctx.externalJobId}/notes`), {
      token: ctx.provider1.token,
      body: { content: 'Used a spare capacitor from the van.' },
    });
    assert.equal(note.status, 201);
    assert.equal(note.body.note.jobId, ctx.externalJobId);

    const list = await get(path(`/${ctx.externalJobId}/notes`), { token: ctx.provider1.token });
    assert.equal(list.status, 200);
    assert.equal(list.body.notes.length, 1);

    assert.equal(
      (await get(path(`/${ctx.externalJobId}/notes`), { token: ctx.provider2.token })).status,
      404,
    );
  });

  it('provider can delete their own external job', async () => {
    const deleted = await del(path(`/${ctx.externalJobId}`), { token: ctx.provider1.token });
    assert.equal(deleted.status, 200);
    assert.equal((await get(path(`/${ctx.externalJobId}`), { token: ctx.provider1.token })).status, 404);
  });

  it('existing 4Fix jobs still appear and work normally', async () => {
    const jobs = await get('/api/provider/jobs', { token: ctx.provider1.token });
    assert.equal(jobs.status, 200);

    const fourFix = jobs.body.jobs.find((job) => job.id === ctx.requestA.id);
    assert.ok(fourFix);
    assert.equal(fourFix.source, '4FIX');
    assert.equal(fourFix.bookingId, ctx.bookingA.id);

    assert.equal((await get(`/api/bookings/${ctx.bookingA.id}`, { token: ctx.provider1.token })).status, 200);
  });
});

describe('completion', () => {
  const path = (suffix) => `/api/bookings/${ctx.bookingA.id}${suffix}`;

  it('completes the job without any payment step', async () => {
    const completed = await post(`/api/requests/${ctx.requestA.id}/complete`, {
      token: ctx.provider1.token,
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.request.status, 'COMPLETED');
    // The assigned provider still has the job's location on every lifecycle response.
    assert.equal(completed.body.request.address.addressLine, '12 Lake View Road');

    const booking = await get(path(''), { token: ctx.customerA.token });
    assert.equal(booking.body.booking.status, 'COMPLETED');
    assert.ok(booking.body.booking.timeline.completedAt);

    const closed = await patch(path('/location'), {
      token: ctx.provider1.token,
      body: { latitude: 1, longitude: 1 },
    });
    assert.equal(closed.status, 409);

    const { default: mongoose } = await import('mongoose');
    const collections = (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name);
    assert.equal(collections.includes('payments'), false);
    assert.equal(collections.includes('quotes'), false);
  });
});

describe('reviews', () => {
  const path = (suffix) => `/api/bookings/${ctx.bookingA.id}${suffix}`;

  it('validates rating and ownership', async () => {
    for (const rating of [0, 6, 4.5, '5', undefined]) {
      const result = await post(path('/review'), { token: ctx.customerA.token, body: { rating } });
      assert.equal(result.status, 400, String(rating));
    }

    assert.equal(
      (await post(path('/review'), { token: ctx.customerB.token, body: { rating: 5 } })).status,
      403,
    );
    assert.equal(
      (await post(path('/review'), { token: ctx.provider1.token, body: { rating: 5 } })).status,
      403,
    );
    assert.equal((await get(path('/review'), { token: ctx.customerA.token })).status, 404);
  });

  it('requires a completed booking', async () => {
    const result = await post(`/api/bookings/${ctx.bookingB.id}/review`, {
      token: ctx.customerB.token,
      body: { rating: 4 },
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'BOOKING_NOT_COMPLETED');
  });

  it('stores one review per booking and aggregates the provider rating', async () => {
    const created = await post(path('/review'), {
      token: ctx.customerA.token,
      body: { rating: 4, comment: 'Quick and tidy.', providerId: ctx.provider2.user.id },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.review.providerId, ctx.provider1.user.id);
    assert.equal(created.body.review.rating, 4);

    const duplicate = await post(path('/review'), { token: ctx.customerA.token, body: { rating: 1 } });
    assert.equal(duplicate.status, 409);

    const fetched = await get(path('/review'), { token: ctx.provider1.token });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.review.comment, 'Quick and tidy.');

    const profile = await get(`/api/providers/${ctx.provider1.user.id}`);
    assert.equal(profile.body.provider.rating, 4);
    assert.equal(profile.body.provider.reviewCount, 1);
    assert.equal(profile.body.provider.completedJobs, 1);

    const reviews = await get(`/api/providers/${ctx.provider1.user.id}/reviews`);
    assert.equal(reviews.status, 200);
    assert.equal(reviews.body.summary.reviewCount, 1);
    assert.equal(reviews.body.reviews[0].customer.name, 'Asha C');
    assert.equal('customerId' in reviews.body.reviews[0], false);
  });

  it('only one of two concurrent reviews is stored', async () => {
    const flow = await runFullFlow({ customer: ctx.customerB, provider: ctx.provider1 });
    const results = await Promise.all([
      post(`/api/bookings/${flow.bookingId}/review`, { token: ctx.customerB.token, body: { rating: 5 } }),
      post(`/api/bookings/${flow.bookingId}/review`, { token: ctx.customerB.token, body: { rating: 2 } }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);

    const profile = await get(`/api/providers/${ctx.provider1.user.id}`);
    assert.equal(profile.body.provider.reviewCount, 2);
    assert.equal(profile.body.provider.completedJobs, 2);
    assert.ok(profile.body.provider.rating === 4.5 || profile.body.provider.rating === 3);
  });
});

describe('lifecycle safety', () => {
  it('never moves a completed request or booking backwards', async () => {
    assert.equal(
      (await post(`/api/requests/${ctx.requestA.id}/start`, { token: ctx.provider1.token })).status,
      409,
    );
    assert.equal(
      (await post(`/api/requests/${ctx.requestA.id}/schedule`, {
        token: ctx.provider1.token,
        body: { scheduledDate: dateOnly(4), scheduledTime: '10:00' },
      })).status,
      409,
    );
    assert.equal(
      (await post(`/api/bookings/${ctx.bookingA.id}/on-the-way`, { token: ctx.provider1.token })).status,
      409,
    );
  });

  it('runs the whole V1 flow with no quote, confirmation or payment', async () => {
    const created = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.plumbing.id),
    });
    const requestId = created.body.request.id;

    const accepted = await post(`/api/requests/${requestId}/accept`, { token: ctx.provider2.token });
    assert.equal(accepted.status, 200);
    const bookingId = accepted.body.booking.id;

    // Start before scheduling is not allowed: ACCEPTED → SCHEDULED comes first.
    assert.equal((await post(`/api/requests/${requestId}/start`, { token: ctx.provider2.token })).status, 409);

    assert.equal(
      (await post(`/api/requests/${requestId}/schedule`, {
        token: ctx.provider2.token,
        body: { scheduledDate: dateOnly(1), scheduledTime: '15:00' },
      })).status,
      200,
    );
    assert.equal((await post(`/api/bookings/${bookingId}/on-the-way`, { token: ctx.provider2.token })).status, 200);
    assert.equal((await post(`/api/bookings/${bookingId}/arrived`, { token: ctx.provider2.token })).status, 200);
    assert.equal((await post(`/api/requests/${requestId}/start`, { token: ctx.provider2.token })).status, 200);
    const done = await post(`/api/requests/${requestId}/complete`, { token: ctx.provider2.token });
    assert.equal(done.status, 200);
    assert.equal(done.body.request.status, 'COMPLETED');

    const detail = await get(`/api/requests/${requestId}`, { token: ctx.customerA.token });
    assert.equal(detail.body.request.booking.id, bookingId);
    assert.equal(detail.body.request.booking.status, 'COMPLETED');

    const review = await post(`/api/bookings/${bookingId}/review`, {
      token: ctx.customerA.token,
      body: { rating: 5 },
    });
    assert.equal(review.status, 201);
    assert.equal(review.body.review.providerId, ctx.provider2.user.id);
  });

  it('only one of two concurrent lifecycle transitions succeeds', async () => {
    const flow = await runFullFlow({ customer: ctx.customerA, provider: ctx.provider2, complete: false });
    const results = await Promise.all([
      post(`/api/bookings/${flow.bookingId}/on-the-way`, { token: ctx.provider2.token }),
      post(`/api/bookings/${flow.bookingId}/on-the-way`, { token: ctx.provider2.token }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  });
});

describe('security', () => {
  it('returns 401 for every protected endpoint without a token', async () => {
    const id = '64b000000000000000000000';
    const endpoints = [
      ['GET', '/api/requests'],
      ['POST', '/api/requests'],
      ['GET', `/api/requests/${id}`],
      ['POST', `/api/requests/${id}/cancel`],
      ['POST', `/api/requests/${id}/accept`],
      ['POST', `/api/requests/${id}/schedule`],
      ['POST', `/api/requests/${id}/start`],
      ['POST', `/api/requests/${id}/complete`],
      ['GET', '/api/provider/requests'],
      ['GET', `/api/provider/requests/${id}`],
      ['GET', '/api/provider/jobs'],
      ['GET', '/api/bookings'],
      ['GET', `/api/bookings/${id}`],
      ['GET', `/api/bookings/${id}/tracking`],
      ['POST', `/api/bookings/${id}/on-the-way`],
      ['POST', `/api/bookings/${id}/arrived`],
      ['PATCH', `/api/bookings/${id}/location`],
      ['POST', `/api/bookings/${id}/chat`],
      ['GET', `/api/bookings/${id}/chat`],
      ['GET', `/api/bookings/${id}/messages`],
      ['POST', `/api/bookings/${id}/messages`],
      ['POST', `/api/bookings/${id}/messages/read`],
      ['POST', `/api/bookings/${id}/review`],
      ['GET', `/api/bookings/${id}/review`],
      ['PATCH', '/api/users/me'],
      ['GET', '/api/auth/me'],
      ['POST', '/api/uploads/image'],
      ['POST', '/api/uploads/audio'],
    ];

    for (const [method, path] of endpoints) {
      const result = await api(method, path);
      assert.equal(result.status, 401, `${method} ${path}`);
    }
  });

  it('keeps public endpoints public', async () => {
    assert.equal((await get('/api/services')).status, 200);
    assert.equal((await get(`/api/providers/${ctx.provider1.user.id}`)).status, 200);
    assert.equal((await get(`/api/providers/${ctx.provider1.user.id}/reviews`)).status, 200);
  });
});

async function uploadRequest({ token, mimeType = 'image/png', filename = 'photo.png', bytes, omitFile = false } = {}) {
  const formData = new FormData();

  if (!omitFile) {
    const content = bytes || new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    formData.append('image', new Blob([content], { type: mimeType }), filename);
  }

  const response = await fetch(`${baseUrl}/api/uploads/image`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  const body = await response.json().catch(() => ({}));

  return { status: response.status, body };
}

function mockCloudinaryUpload(implementation) {
  const original = cloudinary.uploader.upload;
  cloudinary.uploader.upload = implementation;
  return () => {
    cloudinary.uploader.upload = original;
  };
}

describe('uploads', () => {
  it('rejects unauthenticated requests', async () => {
    const result = await uploadRequest({});
    assert.equal(result.status, 401);
  });

  it('rejects when no image field is provided', async () => {
    const result = await uploadRequest({ token: ctx.customerA.token, omitFile: true });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'IMAGE_REQUIRED');
  });

  it('rejects non-image file types', async () => {
    const result = await uploadRequest({
      token: ctx.customerA.token,
      mimeType: 'text/plain',
      filename: 'notes.txt',
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'INVALID_FILE_TYPE');
  });

  it('rejects files over 5MB', async () => {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1024);
    const result = await uploadRequest({ token: ctx.customerA.token, bytes: oversized });
    assert.equal(result.status, 413);
    assert.equal(result.body.error.code, 'FILE_TOO_LARGE');
  });

  it('uploads successfully and returns asset info', async () => {
    const restore = mockCloudinaryUpload(async () => ({
      secure_url: 'https://res.cloudinary.com/demo/image/upload/v1700000000/4fix/abc123.png',
      public_id: '4fix/abc123',
      width: 800,
      height: 600,
      format: 'png',
    }));

    try {
      const result = await uploadRequest({ token: ctx.customerA.token });

      assert.equal(result.status, 201);
      assert.deepEqual(result.body.image, {
        url: 'https://res.cloudinary.com/demo/image/upload/v1700000000/4fix/abc123.png',
        publicId: '4fix/abc123',
        width: 800,
        height: 600,
        format: 'png',
      });
    } finally {
      restore();
    }
  });

  it('handles Cloudinary failures without leaking secrets', async () => {
    const restore = mockCloudinaryUpload(async () => {
      throw new Error('Cloudinary rejected the upload: invalid api_secret');
    });

    try {
      const result = await uploadRequest({ token: ctx.customerA.token });

      assert.equal(result.status, 502);
      assert.equal(result.body.error.code, 'UPLOAD_FAILED');

      const raw = JSON.stringify(result.body);
      assert.equal(/api[_-]?secret/i.test(raw), false);
      assert.equal(raw.includes('invalid api_secret'), false);
    } finally {
      restore();
    }
  });
});

describe('admin', () => {
  it('every admin endpoint requires authentication and the ADMIN role', async () => {
    const id = '64b000000000000000000000';
    const endpoints = [
      ['GET', '/api/admin/dashboard'],
      ['GET', '/api/admin/services'],
      ['POST', '/api/admin/services'],
      ['GET', `/api/admin/services/${id}`],
      ['PATCH', `/api/admin/services/${id}`],
      ['DELETE', `/api/admin/services/${id}`],
      ['GET', '/api/admin/providers'],
      ['GET', `/api/admin/providers/${id}`],
      ['PATCH', `/api/admin/providers/${id}/status`],
      ['GET', '/api/admin/customers'],
      ['GET', `/api/admin/customers/${id}`],
      ['GET', '/api/admin/requests'],
      ['GET', `/api/admin/requests/${id}`],
      ['GET', '/api/admin/bookings'],
      ['GET', `/api/admin/bookings/${id}`],
      ['GET', '/api/admin/reviews'],
      ['GET', `/api/admin/reviews/${id}`],
    ];

    for (const [method, path] of endpoints) {
      assert.equal((await api(method, path)).status, 401, `${method} ${path} (no token)`);
      assert.equal(
        (await api(method, path, { token: ctx.customerA.token })).status,
        403,
        `${method} ${path} (customer)`,
      );
      assert.equal(
        (await api(method, path, { token: ctx.provider1.token })).status,
        403,
        `${method} ${path} (provider)`,
      );
    }
  });

  it('admin can view the dashboard with server-aggregated counts', async () => {
    const result = await get('/api/admin/dashboard', { token: ctx.admin.token });

    assert.equal(result.status, 200);
    assert.equal(typeof result.body.counts.totalCustomers, 'number');
    assert.equal(typeof result.body.counts.totalProviders, 'number');
    assert.equal(typeof result.body.counts.activeProviders, 'number');
    assert.equal(typeof result.body.counts.openRequests, 'number');
    assert.equal(typeof result.body.counts.acceptedRequests, 'number');
    assert.equal(typeof result.body.counts.activeBookings, 'number');
    assert.equal(typeof result.body.counts.completedBookings, 'number');
    assert.equal('openQuotes' in result.body.counts, false);
    assert.equal('pendingPayments' in result.body.counts, false);
    assert.ok(Array.isArray(result.body.recent.requests));
    assert.equal('quotes' in result.body.recent, false);
    assert.ok(Array.isArray(result.body.recent.bookings));
  });

  it('admin can create, list, fetch and update a service', async () => {
    const created = await post('/api/admin/services', {
      token: ctx.admin.token,
      body: {
        name: 'Pest Control',
        description: 'Home pest control treatment.',
        category: 'pest',
        startingPrice: 799,
        issues: [
          { key: 'ants', label: 'Ants' },
          { key: 'cockroaches', label: 'Cockroaches' },
        ],
      },
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.service.category, 'PEST');
    assert.equal(created.body.service.isActive, true);
    assert.deepEqual(
      created.body.service.issues.map((issue) => issue.key),
      ['ANTS', 'COCKROACHES'],
    );
    const serviceId = created.body.service.id;

    const listed = await get('/api/admin/services', { token: ctx.admin.token });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.services.some((service) => service.id === serviceId));
    assert.equal(typeof listed.body.total, 'number');

    const fetched = await get(`/api/admin/services/${serviceId}`, { token: ctx.admin.token });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.service.name, 'Pest Control');

    const updated = await patch(`/api/admin/services/${serviceId}`, {
      token: ctx.admin.token,
      body: { startingPrice: 899, isActive: false },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.service.startingPrice, 899);
    assert.equal(updated.body.service.isActive, false);

    // Deactivated services drop off the public catalogue immediately.
    const publicList = await get('/api/services');
    assert.equal(
      publicList.body.services.some((service) => service.id === serviceId),
      false,
    );

    assert.equal(
      (await post('/api/admin/services', { token: ctx.customerA.token, body: {} })).status,
      403,
    );
  });

  it('rejects invalid service input', async () => {
    const missingFields = await post('/api/admin/services', {
      token: ctx.admin.token,
      body: { description: 'A short valid description.' },
    });
    assert.equal(missingFields.status, 400);

    const duplicateIssueKeys = await post('/api/admin/services', {
      token: ctx.admin.token,
      body: {
        name: 'Duplicate Issue Keys',
        description: 'Should be rejected.',
        category: 'MISC',
        issues: [
          { key: 'A', label: 'A' },
          { key: 'a', label: 'Also A' },
        ],
      },
    });
    assert.equal(duplicateIssueKeys.status, 400);
  });

  it('deletes a service only when it is not referenced by any request', async () => {
    const unused = await post('/api/admin/services', {
      token: ctx.admin.token,
      body: { name: 'Temp Unused Service', description: 'To be deleted shortly.', category: 'MISC' },
    });

    const deleted = await api('DELETE', `/api/admin/services/${unused.body.service.id}`, {
      token: ctx.admin.token,
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.deleted, true);
    assert.equal(
      (await get(`/api/admin/services/${unused.body.service.id}`, { token: ctx.admin.token })).status,
      404,
    );

    // ctx.acRepair already has real requests against it from earlier in the suite.
    const inUse = await api('DELETE', `/api/admin/services/${ctx.acRepair.id}`, {
      token: ctx.admin.token,
    });
    assert.equal(inUse.status, 409);
    assert.equal(inUse.body.error.code, 'SERVICE_IN_USE');
  });

  it('admin can list and view providers, and toggle a provider\'s active status', async () => {
    const listed = await get('/api/admin/providers', { token: ctx.admin.token });
    assert.equal(listed.status, 200);
    const row = listed.body.providers.find((provider) => provider.id === ctx.provider1.user.id);
    assert.ok(row);
    assert.equal('passwordHash' in row, false);

    const detail = await get(`/api/admin/providers/${ctx.provider1.user.id}`, {
      token: ctx.admin.token,
    });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.provider.id, ctx.provider1.user.id);
    assert.equal('passwordHash' in detail.body.provider, false);
    assert.ok(Array.isArray(detail.body.bookings));
    assert.ok(Array.isArray(detail.body.reviews));

    const temp = await signup('PROVIDER', 'Temp Provider', '9876519001');
    const deactivated = await patch(`/api/admin/providers/${temp.user.id}/status`, {
      token: ctx.admin.token,
      body: { isActive: false },
    });
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.body.provider.isActive, false);

    // A deactivated account can no longer authenticate with its existing token.
    assert.equal((await get('/api/auth/me', { token: temp.token })).status, 401);

    const reactivated = await patch(`/api/admin/providers/${temp.user.id}/status`, {
      token: ctx.admin.token,
      body: { isActive: true },
    });
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.body.provider.isActive, true);

    assert.equal(
      (
        await patch(`/api/admin/providers/${temp.user.id}/status`, {
          token: ctx.admin.token,
          body: { isActive: 'yes' },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await patch(`/api/admin/providers/${ctx.customerA.user.id}/status`, {
          token: ctx.admin.token,
          body: { isActive: false },
        })
      ).status,
      404,
    );
  });

  it('admin can list and view customers', async () => {
    const listed = await get('/api/admin/customers', { token: ctx.admin.token });
    assert.equal(listed.status, 200);
    const row = listed.body.customers.find((customer) => customer.id === ctx.customerA.user.id);
    assert.ok(row);
    assert.equal('passwordHash' in row, false);

    const detail = await get(`/api/admin/customers/${ctx.customerA.user.id}`, {
      token: ctx.admin.token,
    });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.customer.id, ctx.customerA.user.id);
    assert.equal('passwordHash' in detail.body.customer, false);
    assert.ok(Array.isArray(detail.body.requests));
    assert.ok(Array.isArray(detail.body.bookings));
    assert.ok(Array.isArray(detail.body.reviews));

    assert.equal(
      (await get('/api/admin/customers/64b000000000000000000000', { token: ctx.admin.token })).status,
      404,
    );
  });

  it('admin can list and filter requests, and view full request detail', async () => {
    const listed = await get('/api/admin/requests', { token: ctx.admin.token });
    assert.equal(listed.status, 200);
    const row = listed.body.requests.find((request) => request.id === ctx.requestA.id);
    assert.ok(row);
    assert.equal(row.customer.id, ctx.customerA.user.id);

    const filtered = await get(
      `/api/admin/requests?customer=${ctx.customerA.user.id}&status=CANCELLED`,
      { token: ctx.admin.token },
    );
    assert.equal(filtered.status, 200);
    assert.ok(filtered.body.requests.every((request) => request.status === 'CANCELLED'));
    assert.ok(filtered.body.requests.every((request) => request.customer.id === ctx.customerA.user.id));

    const detail = await get(`/api/admin/requests/${ctx.requestA.id}`, { token: ctx.admin.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.request.customer.id, ctx.customerA.user.id);
    assert.equal(detail.body.request.status, 'COMPLETED');
    assert.equal(detail.body.request.selectedProvider.id, ctx.provider1.user.id);
    assert.equal('quotes' in detail.body, false);
    assert.equal('payment' in detail.body, false);
    assert.ok(detail.body.booking);
    assert.equal(detail.body.booking.id, ctx.bookingA.id);
    assert.ok(detail.body.review);
    assert.equal(detail.body.review.rating, 4);

    assert.equal(
      (await get('/api/admin/requests/64b000000000000000000000', { token: ctx.admin.token })).status,
      404,
    );
  });

  it('admin can list and filter bookings, and view booking detail', async () => {
    const listed = await get('/api/admin/bookings', { token: ctx.admin.token });
    assert.equal(listed.status, 200);
    const row = listed.body.bookings.find((booking) => booking.id === ctx.bookingA.id);
    assert.ok(row);
    assert.equal(row.arrivalCode, ctx.bookingA.arrivalCode);
    // Admin needs both identities at once, unlike a participant viewing their own booking.
    assert.equal(row.customer?.id, ctx.customerA.user.id);
    assert.equal(row.provider?.id, ctx.provider1.user.id);

    const filtered = await get('/api/admin/bookings?status=COMPLETED', { token: ctx.admin.token });
    assert.equal(filtered.status, 200);
    assert.ok(filtered.body.bookings.every((booking) => booking.status === 'COMPLETED'));

    const detail = await get(`/api/admin/bookings/${ctx.bookingA.id}`, { token: ctx.admin.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.booking.id, ctx.bookingA.id);
    assert.equal(detail.body.booking.customer?.id, ctx.customerA.user.id);
    assert.equal(detail.body.booking.provider?.id, ctx.provider1.user.id);

    assert.equal(
      (await get('/api/admin/bookings/64b000000000000000000000', { token: ctx.admin.token })).status,
      404,
    );
  });

  it('admin can list and view reviews', async () => {
    const listed = await get('/api/admin/reviews', { token: ctx.admin.token });
    assert.equal(listed.status, 200);
    const row = listed.body.reviews.find((review) => review.bookingId === ctx.bookingA.id);
    assert.ok(row);
    assert.equal(row.rating, 4);
    assert.ok(row.customer?.name);

    const detail = await get(`/api/admin/reviews/${row.id}`, { token: ctx.admin.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.review.id, row.id);

    assert.equal(
      (await get('/api/admin/reviews/64b000000000000000000000', { token: ctx.admin.token })).status,
      404,
    );
  });

  it('never returns passwordHash from any admin endpoint', async () => {
    const responses = await Promise.all([
      get('/api/admin/providers', { token: ctx.admin.token }),
      get(`/api/admin/providers/${ctx.provider1.user.id}`, { token: ctx.admin.token }),
      get('/api/admin/customers', { token: ctx.admin.token }),
      get(`/api/admin/customers/${ctx.customerA.user.id}`, { token: ctx.admin.token }),
      get('/api/admin/dashboard', { token: ctx.admin.token }),
      get('/api/admin/requests', { token: ctx.admin.token }),
      get('/api/admin/bookings', { token: ctx.admin.token }),
    ]);

    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(JSON.stringify(response.body).includes('passwordHash'), false);
    }
  });
});

describe('admin chat access', () => {
  it('admin can read any conversation platform-wide, with sender identity intact', async () => {
    // Conversation + 2 messages already exist on ctx.bookingA from the 'chat' suite above.
    const path = (suffix) => `/api/bookings/${ctx.bookingA.id}${suffix}`;

    const conversation = await get(path('/chat'), { token: ctx.admin.token });
    assert.equal(conversation.status, 200);
    assert.equal(conversation.body.conversation.bookingId, ctx.bookingA.id);

    const messages = await get(path('/messages'), { token: ctx.admin.token });
    assert.equal(messages.status, 200);
    assert.ok(messages.body.messages.length >= 2);
    assert.ok(messages.body.messages.every((message) => ['CUSTOMER', 'PROVIDER'].includes(message.senderRole)));
  });

  it('admin is read-only: cannot open, send or mark a conversation read', async () => {
    const path = (suffix) => `/api/bookings/${ctx.bookingA.id}${suffix}`;

    assert.equal((await post(path('/chat'), { token: ctx.admin.token })).status, 403);
    assert.equal(
      (await post(path('/messages'), { token: ctx.admin.token, body: { message: 'hi' } })).status,
      403,
    );
    assert.equal((await post(path('/messages/read'), { token: ctx.admin.token })).status, 403);
  });

  it('reports 404, not a bypass, for a conversation that was never started', async () => {
    const customer = await signup('CUSTOMER', 'Chat Admin Customer', '9876522001');
    const provider = await signup('PROVIDER', 'Chat Admin Provider', '9876522011');
    const flow = await runFullFlow({ customer, provider, complete: false });

    const result = await get(`/api/bookings/${flow.bookingId}/chat`, { token: ctx.admin.token });
    assert.equal(result.status, 404);
  });
});

async function uploadAudioRequest({
  token,
  mimeType = 'audio/webm',
  filename = 'note.webm',
  bytes,
  omitFile = false,
} = {}) {
  const formData = new FormData();

  if (!omitFile) {
    const content = bytes || new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    formData.append('audio', new Blob([content], { type: mimeType }), filename);
  }

  const response = await fetch(`${baseUrl}/api/uploads/audio`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  const body = await response.json().catch(() => ({}));

  return { status: response.status, body };
}

describe('voice notes', () => {
  it('the upload endpoint is customer-only', async () => {
    assert.equal((await uploadAudioRequest({ token: ctx.provider1.token })).status, 403);
    assert.equal((await uploadAudioRequest({ token: ctx.admin.token })).status, 403);
  });

  it('rejects when no audio field is provided', async () => {
    const result = await uploadAudioRequest({ token: ctx.customerA.token, omitFile: true });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'AUDIO_REQUIRED');
  });

  it('rejects non-audio file types', async () => {
    const result = await uploadAudioRequest({
      token: ctx.customerA.token,
      mimeType: 'text/plain',
      filename: 'notes.txt',
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'INVALID_FILE_TYPE');
  });

  it('rejects files over 10MB', async () => {
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1024);
    const result = await uploadAudioRequest({ token: ctx.customerA.token, bytes: oversized });
    assert.equal(result.status, 413);
    assert.equal(result.body.error.code, 'FILE_TOO_LARGE');
  });

  it('uploads successfully and returns asset info', async () => {
    const restore = mockCloudinaryUpload(async () => ({
      secure_url:
        'https://res.cloudinary.com/demo/video/upload/v1700000000/4fix/voice-notes/abc123.webm',
      public_id: '4fix/voice-notes/abc123',
      format: 'webm',
      duration: 12.4,
    }));

    try {
      const result = await uploadAudioRequest({ token: ctx.customerA.token });

      assert.equal(result.status, 201);
      assert.equal(
        result.body.audio.url,
        'https://res.cloudinary.com/demo/video/upload/v1700000000/4fix/voice-notes/abc123.webm',
      );
      assert.equal(result.body.audio.format, 'webm');
      assert.equal(result.body.audio.durationSeconds, 12.4);
    } finally {
      restore();
    }
  });

  it('creates a request without a voice note exactly as before', async () => {
    const result = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.acRepair.id, { issueKey: 'NOT_COOLING' }),
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.request.voiceNote, null);
  });

  it('creates a request with a valid voice note and persists it', async () => {
    const voiceNote = {
      url: 'https://res.cloudinary.com/demo/video/upload/v1700000000/4fix/voice-notes/xyz789.webm',
      format: 'webm',
      durationSeconds: 42,
    };

    const created = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.acRepair.id, { issueKey: 'NOT_COOLING', voiceNote }),
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.request.voiceNote, voiceNote);

    const fetched = await get(`/api/requests/${created.body.request.id}`, {
      token: ctx.customerA.token,
    });
    assert.deepEqual(fetched.body.request.voiceNote, voiceNote);
  });

  it('rejects an invalid voice note payload', async () => {
    const missingUrl = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.acRepair.id, {
        issueKey: 'NOT_COOLING',
        voiceNote: { format: 'webm' },
      }),
    });
    assert.equal(missingUrl.status, 400);

    const badFormat = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.acRepair.id, {
        issueKey: 'NOT_COOLING',
        voiceNote: { url: 'https://res.cloudinary.com/demo/x.exe', format: 'exe' },
      }),
    });
    assert.equal(badFormat.status, 400);

    const negativeDuration = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.acRepair.id, {
        issueKey: 'NOT_COOLING',
        voiceNote: { url: 'https://res.cloudinary.com/demo/x.webm', durationSeconds: -1 },
      }),
    });
    assert.equal(negativeDuration.status, 400);
  });

  it('is visible to the provider, and on the admin request/booking views, once booked', async () => {
    const customer = await signup('CUSTOMER', 'Voice Note Customer', '9876523001');
    const provider = await signup('PROVIDER', 'Voice Note Provider', '9876523011');
    const voiceNote = {
      url: 'https://res.cloudinary.com/demo/video/upload/v1700000000/4fix/voice-notes/job123.webm',
      format: 'webm',
      durationSeconds: 18,
    };

    const created = await post('/api/requests', {
      token: customer.token,
      body: requestPayload(ctx.acRepair.id, { issueKey: 'NOT_COOLING', voiceNote }),
    });
    const requestId = created.body.request.id;

    const providerView = await get(`/api/provider/requests/${requestId}`, { token: provider.token });
    assert.equal(providerView.status, 200);
    assert.deepEqual(providerView.body.request.voiceNote, voiceNote);

    const adminRequestView = await get(`/api/admin/requests/${requestId}`, { token: ctx.admin.token });
    assert.equal(adminRequestView.status, 200);
    assert.deepEqual(adminRequestView.body.request.voiceNote, voiceNote);

    const accepted = await post(`/api/requests/${requestId}/accept`, { token: provider.token });
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.body.booking.request.voiceNote, voiceNote);

    const adminBookingView = await get(`/api/admin/bookings/${accepted.body.booking.id}`, {
      token: ctx.admin.token,
    });
    assert.equal(adminBookingView.status, 200);
    assert.deepEqual(adminBookingView.body.booking.request.voiceNote, voiceNote);
  });

  it('never lets one customer see another customer\'s request, voice note included', async () => {
    const owner = await signup('CUSTOMER', 'Voice Owner', '9876523051');
    const stranger = await signup('CUSTOMER', 'Voice Stranger', '9876523052');
    const voiceNote = {
      url: 'https://res.cloudinary.com/demo/video/upload/v1700000000/4fix/voice-notes/private1.webm',
    };

    const created = await post('/api/requests', {
      token: owner.token,
      body: requestPayload(ctx.acRepair.id, { issueKey: 'NOT_COOLING', voiceNote }),
    });

    const forbidden = await get(`/api/requests/${created.body.request.id}`, { token: stranger.token });
    assert.equal(forbidden.status, 403);
  });
});

describe('admin area preview (Customer View / Provider View)', () => {
  it('GET /api/requests for admin is always empty, never another customer\'s requests', async () => {
    // ctx.customerA already has real requests from earlier suites.
    const asAdmin = await get('/api/requests', { token: ctx.admin.token });
    assert.equal(asAdmin.status, 200);
    assert.deepEqual(asAdmin.body.requests, []);

    const asCustomer = await get('/api/requests', { token: ctx.customerA.token });
    assert.ok(asCustomer.body.requests.length > 0);
  });

  it('GET /api/bookings for admin is always empty, never another user\'s bookings', async () => {
    // ctx.bookingA already exists from earlier suites.
    const asAdmin = await get('/api/bookings', { token: ctx.admin.token });
    assert.equal(asAdmin.status, 200);
    assert.deepEqual(asAdmin.body.bookings, []);
  });

  it('GET /api/provider/jobs for admin is always empty, never another provider\'s jobs', async () => {
    // ctx.provider1 already has real jobs from earlier suites.
    const asAdmin = await get('/api/provider/jobs', { token: ctx.admin.token });
    assert.equal(asAdmin.status, 200);
    assert.deepEqual(asAdmin.body.jobs, []);
  });

  it('GET /api/provider/requests for admin shows the same open discovery feed a provider sees', async () => {
    const customer = await signup('CUSTOMER', 'Preview Customer', '9876524001');
    const created = await post('/api/requests', {
      token: customer.token,
      body: requestPayload(ctx.acRepair.id, { issueKey: 'NOT_COOLING' }),
    });
    const requestId = created.body.request.id;

    const asAdmin = await get('/api/provider/requests', { token: ctx.admin.token });
    assert.equal(asAdmin.status, 200);
    assert.ok(asAdmin.body.requests.some((request) => request.id === requestId));

    const asProvider = await get('/api/provider/requests', { token: ctx.provider1.token });
    assert.ok(asProvider.body.requests.some((request) => request.id === requestId));
  });

  it('GET /api/provider/requests/:id lets admin view an open request, but not one already booked', async () => {
    const customer = await signup('CUSTOMER', 'Preview Customer Two', '9876524002');
    const provider = await signup('PROVIDER', 'Preview Provider', '9876524011');
    const flow = await runFullFlow({ customer, provider, complete: false });

    // Still open at creation, before any provider accepts it.
    const created = await post('/api/requests', {
      token: customer.token,
      body: requestPayload(ctx.acRepair.id, { issueKey: 'NOT_COOLING' }),
    });
    const openRequestView = await get(`/api/provider/requests/${created.body.request.id}`, {
      token: ctx.admin.token,
    });
    assert.equal(openRequestView.status, 200);
    assert.equal(openRequestView.body.request.location, null);

    // flow.requestId is already ACCEPTED (a real booking exists) — no longer
    // in the open marketplace, so admin gets the same 403 an uninvolved provider would.
    const bookedRequestView = await get(`/api/provider/requests/${flow.requestId}`, {
      token: ctx.admin.token,
    });
    assert.equal(bookedRequestView.status, 403);
  });

  it('admin previewing the customer/provider side still cannot perform any customer/provider mutation', async () => {
    const customer = await signup('CUSTOMER', 'Preview Mutation Customer', '9876524003');
    const provider = await signup('PROVIDER', 'Preview Mutation Provider', '9876524012');
    const flow = await runFullFlow({ customer, provider, complete: false });

    const attempts = [
      ['POST', '/api/requests', { serviceId: ctx.acRepair.id }],
      ['POST', `/api/requests/${flow.requestId}/cancel`, {}],
      ['POST', `/api/requests/${flow.requestId}/accept`, {}],
      ['POST', `/api/requests/${flow.requestId}/schedule`, {}],
      ['POST', `/api/requests/${flow.requestId}/start`, {}],
      ['POST', `/api/requests/${flow.requestId}/complete`, {}],
      ['POST', `/api/bookings/${flow.bookingId}/on-the-way`, {}],
      ['POST', `/api/bookings/${flow.bookingId}/arrived`, {}],
      ['PATCH', `/api/bookings/${flow.bookingId}/location`, { latitude: 1, longitude: 1 }],
      ['POST', `/api/bookings/${flow.bookingId}/chat`, {}],
      ['POST', `/api/bookings/${flow.bookingId}/messages`, { message: 'hi' }],
      ['POST', `/api/bookings/${flow.bookingId}/review`, { rating: 5 }],
    ];

    for (const [method, path, body] of attempts) {
      const result = await api(method, path, { token: ctx.admin.token, body });
      assert.equal(result.status, 403, `${method} ${path} unexpectedly allowed for admin (got ${result.status})`);
    }
  });
});

describe('customer service location', () => {
  const LOCATION = { latitude: 12.9716, longitude: 77.5946, address: 'Flat 3B, near the temple' };
  const NAV_URL = 'https://www.google.com/maps/dir/?api=1&destination=12.9716,77.5946';
  const loc = {};

  before(async () => {
    loc.customer = await signup('CUSTOMER', 'Location Customer', '9876525001');
    loc.otherCustomer = await signup('CUSTOMER', 'Other Location Customer', '9876525002');
    loc.selected = await signup('PROVIDER', 'Selected Location Provider', '9876525011');
    loc.other = await signup('PROVIDER', 'Other Location Provider', '9876525012');
    loc.unrelated = await signup('PROVIDER', 'Unrelated Location Provider', '9876525013');
  });

  function locationPayload(overrides = {}) {
    return requestPayload(ctx.acRepair.id, { address: undefined, location: LOCATION, ...overrides });
  }

  it('accepts valid coordinates without a typed address and persists them', async () => {
    const created = await post('/api/requests', { token: loc.customer.token, body: locationPayload() });

    assert.equal(created.status, 201);
    assert.equal(created.body.request.address, null);
    assert.deepEqual(created.body.request.location, { ...LOCATION, navigationUrl: NAV_URL });
    loc.requestId = created.body.request.id;

    const { default: ServiceRequest } = await import('../src/models/ServiceRequest.js');
    const stored = await ServiceRequest.findById(loc.requestId);
    assert.equal(stored.location.latitude, LOCATION.latitude);
    assert.equal(stored.location.longitude, LOCATION.longitude);
    assert.equal(stored.location.address, LOCATION.address);
  });

  it('accepts a location together with a typed address, and boundary coordinates', async () => {
    const both = await post('/api/requests', {
      token: loc.customer.token,
      body: requestPayload(ctx.acRepair.id, { location: { latitude: -90, longitude: 180 } }),
    });
    assert.equal(both.status, 201);
    assert.equal(both.body.request.address.pincode, '560001');
    assert.equal(both.body.request.location.latitude, -90);
    assert.equal(both.body.request.location.longitude, 180);
    assert.equal(both.body.request.location.address, null);
  });

  it('rejects invalid latitude', async () => {
    for (const latitude of [90.0001, -91, '12.97', null]) {
      const result = await post('/api/requests', {
        token: loc.customer.token,
        body: locationPayload({ location: { latitude, longitude: 77.5 } }),
      });
      assert.equal(result.status, 400, `latitude ${latitude}`);
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    }
  });

  it('rejects invalid longitude', async () => {
    for (const longitude of [180.5, -181, '77.5', undefined]) {
      const result = await post('/api/requests', {
        token: loc.customer.token,
        body: locationPayload({ location: { latitude: 12.9, longitude } }),
      });
      assert.equal(result.status, 400, `longitude ${longitude}`);
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    }
  });

  it('rejects a malformed location and a request with neither location nor address', async () => {
    const malformed = await post('/api/requests', {
      token: loc.customer.token,
      body: locationPayload({ location: [12.9, 77.5] }),
    });
    assert.equal(malformed.status, 400);

    const neither = await post('/api/requests', {
      token: loc.customer.token,
      body: requestPayload(ctx.acRepair.id, { address: undefined }),
    });
    assert.equal(neither.status, 400);
  });

  it('the customer sees their own location; other customers cannot read the request', async () => {
    const detail = await get(`/api/requests/${loc.requestId}`, { token: loc.customer.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.request.location.latitude, LOCATION.latitude);
    assert.equal(detail.body.request.location.navigationUrl, NAV_URL);

    const list = await get('/api/requests', { token: loc.customer.token });
    assert.ok(list.body.requests.find((item) => item.id === loc.requestId).location);

    const other = await get(`/api/requests/${loc.requestId}`, { token: loc.otherCustomer.token });
    assert.equal(other.status, 403);
  });

  it('never exposes coordinates in provider discovery or before acceptance', async () => {
    const discovery = await get('/api/provider/requests', { token: loc.unrelated.token });
    assert.equal(discovery.status, 200);
    const listed = discovery.body.requests.find((item) => item.id === loc.requestId);
    assert.ok(listed);
    assert.equal(listed.location, undefined);
    assert.ok(!JSON.stringify(discovery.body).includes('12.9716'));
    assert.ok(!JSON.stringify(discovery.body).includes('Flat 3B'));

    // Open request: any provider may view it, but without coordinates.
    const preview = await get(`/api/provider/requests/${loc.requestId}`, { token: loc.selected.token });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.request.location, null);
  });

  it('the assigned provider receives the location on acceptance; others never do', async () => {
    const accepted = await post(`/api/requests/${loc.requestId}/accept`, { token: loc.selected.token });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.request.location.latitude, LOCATION.latitude);
    assert.equal(accepted.body.request.location.longitude, LOCATION.longitude);
    assert.equal(accepted.body.request.location.navigationUrl, NAV_URL);
    assert.equal(accepted.body.booking.request.location.navigationUrl, NAV_URL);
    loc.bookingId = accepted.body.booking.id;

    const late = await post(`/api/requests/${loc.requestId}/accept`, { token: loc.other.token });
    assert.equal(late.status, 409);
    assert.equal(late.body.request, undefined);
    assert.ok(!JSON.stringify(late.body).includes('12.9716'));

    const asSelected = await get(`/api/provider/requests/${loc.requestId}`, { token: loc.selected.token });
    assert.equal(asSelected.status, 200);
    assert.equal(asSelected.body.request.location.navigationUrl, NAV_URL);

    for (const provider of [loc.other, loc.unrelated]) {
      const denied = await get(`/api/provider/requests/${loc.requestId}`, { token: provider.token });
      assert.equal(denied.status, 403);
    }

    // Admin in "Provider View" is not the assigned provider either.
    const asAdminPreview = await get(`/api/provider/requests/${loc.requestId}`, { token: ctx.admin.token });
    assert.equal(asAdminPreview.body.request?.location ?? null, null);
  });

  it('the assigned provider gets the location on jobs, bookings and transitions; others do not', async () => {
    const jobs = await get('/api/provider/jobs', { token: loc.selected.token });
    const job = jobs.body.jobs.find((item) => item.id === loc.requestId);
    assert.equal(job.location.navigationUrl, NAV_URL);

    const otherJobs = await get('/api/provider/jobs', { token: loc.other.token });
    assert.ok(!otherJobs.body.jobs.some((item) => item.id === loc.requestId));

    const booking = await get(`/api/bookings/${loc.bookingId}`, { token: loc.selected.token });
    assert.equal(booking.status, 200);
    assert.equal(booking.body.booking.request.location.navigationUrl, NAV_URL);

    const customerBooking = await get(`/api/bookings/${loc.bookingId}`, { token: loc.customer.token });
    assert.equal(customerBooking.body.booking.request.location.latitude, LOCATION.latitude);

    for (const provider of [loc.other, loc.unrelated]) {
      const denied = await get(`/api/bookings/${loc.bookingId}`, { token: provider.token });
      assert.equal(denied.status, 403);
    }

    const scheduled = await post(`/api/requests/${loc.requestId}/schedule`, {
      token: loc.selected.token,
      body: { scheduledDate: dateOnly(3), scheduledTime: '11:00' },
    });
    assert.equal(scheduled.status, 200);
    assert.equal(scheduled.body.request.location.latitude, LOCATION.latitude);
  });

  it('admin sees the location through the admin console', async () => {
    const detail = await get(`/api/admin/requests/${loc.requestId}`, { token: ctx.admin.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.request.location.latitude, LOCATION.latitude);
  });

  it('existing requests without coordinates still work everywhere', async () => {
    const legacy = await post('/api/requests', {
      token: loc.customer.token,
      body: requestPayload(ctx.acRepair.id),
    });
    assert.equal(legacy.status, 201);
    assert.equal(legacy.body.request.location, null);

    // Simulate a document written before the field existed.
    const { default: ServiceRequest } = await import('../src/models/ServiceRequest.js');
    const { default: mongoose } = await import('mongoose');
    await ServiceRequest.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(legacy.body.request.id) },
      { $unset: { location: '' } },
    );

    const detail = await get(`/api/requests/${legacy.body.request.id}`, { token: loc.customer.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.request.location, null);
    assert.equal(detail.body.request.address.city, 'Bengaluru');

    const discovery = await get(`/api/provider/requests/${legacy.body.request.id}`, {
      token: loc.unrelated.token,
    });
    assert.equal(discovery.status, 200);
    assert.equal(discovery.body.request.location, null);

    const flow = await runFullFlow({ customer: loc.otherCustomer, provider: loc.unrelated, complete: false });
    const jobs = await get('/api/provider/jobs', { token: loc.unrelated.token });
    assert.equal(jobs.body.jobs.find((item) => item.id === flow.requestId).location, null);
    const booking = await get(`/api/bookings/${flow.bookingId}`, { token: loc.unrelated.token });
    assert.equal(booking.body.booking.request.location, null);
  });

  it('builds the navigation URL from coordinates and refuses to build a broken one', async () => {
    const { buildNavigationUrl } = await import('../src/utils/location.js');
    assert.equal(buildNavigationUrl(12.9716, 77.5946), NAV_URL);
    assert.equal(
      buildNavigationUrl(-33.8688, 151.2093),
      'https://www.google.com/maps/dir/?api=1&destination=-33.8688,151.2093',
    );
    assert.equal(buildNavigationUrl(null, 77.5), null);
    assert.equal(buildNavigationUrl(12.9, undefined), null);
  });
});
