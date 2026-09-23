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

// Drives a request through the full happy path and returns its ids.
async function runFullFlow({ customer, provider, complete = true }) {
  const created = await post('/api/requests', {
    token: customer.token,
    body: requestPayload(ctx.acRepair.id, { issueKey: 'NOT_COOLING' }),
  });
  assert.equal(created.status, 201);
  const requestId = created.body.request.id;

  const quoted = await post(`/api/requests/${requestId}/quotes`, {
    token: provider.token,
    body: { amount: 1200, description: 'Gas refill and service' },
  });
  assert.equal(quoted.status, 201);

  const accepted = await post(`/api/quotes/${quoted.body.quote.id}/accept`, {
    token: customer.token,
  });
  assert.equal(accepted.status, 200);

  const confirmed = await post(`/api/requests/${requestId}/confirm`, { token: customer.token });
  assert.equal(confirmed.status, 200);
  const bookingId = confirmed.body.booking.id;

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

  return { requestId, bookingId, quoteId: quoted.body.quote.id, amount: 1200 };
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

  it('validates input', async () => {
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
  it('discovers available providers for the customer who owns the request', async () => {
    const result = await get(`/api/requests/${ctx.requestA.id}/providers`, {
      token: ctx.customerA.token,
    });

    assert.equal(result.status, 200);
    const ids = result.body.providers.map((provider) => provider.id).sort();
    assert.deepEqual(ids, [ctx.provider1.user.id, ctx.provider2.user.id].sort());

    const provider = result.body.providers[0];
    assert.equal(provider.quote, null);
    assert.equal(provider.rating, null);
    assert.equal(provider.reviewCount, 0);
    assert.equal(provider.completedJobs, 0);
    assert.equal('username' in provider, false);
    assert.equal('passwordHash' in provider, false);

    const forbidden = await get(`/api/requests/${ctx.requestA.id}/providers`, {
      token: ctx.customerB.token,
    });
    assert.equal(forbidden.status, 403);
  });

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

  it('excludes providers whose categories do not cover the service', async () => {
    const plumber = await patch('/api/users/me', {
      token: ctx.provider2.token,
      body: { serviceCategories: ['PLUMBING'] },
    });
    assert.equal(plumber.status, 200);

    const result = await get(`/api/requests/${ctx.requestLegacy.id}/providers`, {
      token: ctx.customerA.token,
    });
    assert.deepEqual(
      result.body.providers.map((provider) => provider.id),
      [ctx.provider1.user.id],
    );

    await patch('/api/users/me', { token: ctx.provider2.token, body: { serviceCategories: [] } });
  });

  it('lets providers quote and keeps competitor quotes private', async () => {
    const quote1 = await post(`/api/requests/${ctx.requestA.id}/quotes`, {
      token: ctx.provider1.token,
      body: { amount: 1500, description: 'Full service with gas top-up' },
    });
    assert.equal(quote1.status, 201);
    ctx.quote1 = quote1.body.quote;

    const quote2 = await post(`/api/requests/${ctx.requestA.id}/quotes`, {
      token: ctx.provider2.token,
      body: { amount: 1300, description: 'Service only' },
    });
    assert.equal(quote2.status, 201);
    ctx.quote2 = quote2.body.quote;

    const provider2View = await get(`/api/requests/${ctx.requestA.id}/quotes`, {
      token: ctx.provider2.token,
    });
    assert.equal(provider2View.body.quotes.length, 1);
    assert.equal(provider2View.body.quotes[0].id, ctx.quote2.id);

    const customerView = await get(`/api/requests/${ctx.requestA.id}/quotes`, {
      token: ctx.customerA.token,
    });
    assert.equal(customerView.body.quotes.length, 2);

    const discovery = await get(`/api/requests/${ctx.requestA.id}/providers`, {
      token: ctx.customerA.token,
    });
    const withQuote = discovery.body.providers.find((p) => p.id === ctx.provider1.user.id);
    assert.equal(withQuote.quote.amount, 1500);
  });

  it('accepting a quote selects the provider exactly once', async () => {
    const accepted = await post(`/api/quotes/${ctx.quote1.id}/accept`, {
      token: ctx.customerA.token,
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.request.status, 'QUOTE_ACCEPTED');
    assert.equal(accepted.body.request.selectedProviderId, ctx.provider1.user.id);
    assert.equal(accepted.body.request.acceptedQuoteId, ctx.quote1.id);
    assert.equal(accepted.body.request.booking, null);

    const twice = await post(`/api/quotes/${ctx.quote1.id}/accept`, { token: ctx.customerA.token });
    assert.equal(twice.status, 409);

    const loser = await post(`/api/quotes/${ctx.quote2.id}/accept`, { token: ctx.customerA.token });
    assert.equal(loser.status, 409);
  });

  it('only one of two concurrent quote acceptances wins', async () => {
    const created = await post('/api/requests', {
      token: ctx.customerB.token,
      body: requestPayload(ctx.acRepair.id, { issueKey: 'MAKING_NOISE' }),
    });
    const requestId = created.body.request.id;
    const [q1, q2] = await Promise.all([
      post(`/api/requests/${requestId}/quotes`, {
        token: ctx.provider1.token,
        body: { amount: 900, description: 'Fix noise' },
      }),
      post(`/api/requests/${requestId}/quotes`, {
        token: ctx.provider2.token,
        body: { amount: 950, description: 'Fix noise too' },
      }),
    ]);

    const results = await Promise.all([
      post(`/api/quotes/${q1.body.quote.id}/accept`, { token: ctx.customerB.token }),
      post(`/api/quotes/${q2.body.quote.id}/accept`, { token: ctx.customerB.token }),
    ]);
    const statuses = results.map((result) => result.status).sort();
    assert.deepEqual(statuses, [200, 409]);
    ctx.requestB = requestId;
  });
});

describe('booking confirmation', () => {
  it('rejects confirmation before a quote is accepted', async () => {
    const result = await post(`/api/requests/${ctx.requestLegacy.id}/confirm`, {
      token: ctx.customerA.token,
    });
    assert.equal(result.status, 409);
  });

  it('creates the booking with honest safety data', async () => {
    const result = await post(`/api/requests/${ctx.requestA.id}/confirm`, {
      token: ctx.customerA.token,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.booking.status, 'CONFIRMED');
    assert.equal(result.body.booking.requestId, ctx.requestA.id);
    assert.equal(result.body.booking.amount, 1500);
    assert.equal(result.body.provider.id, ctx.provider1.user.id);
    assert.equal(result.body.request.booking.id, result.body.booking.id);
    assert.deepEqual(result.body.safety, {
      providerVerified: false,
      insuranceIncluded: false,
      arrivalCode: result.body.booking.arrivalCode,
    });
    assert.match(result.body.safety.arrivalCode, /^\d{4}$/);
    ctx.bookingA = result.body.booking;
  });

  it('is idempotent, including under concurrent duplicate calls', async () => {
    const again = await post(`/api/requests/${ctx.requestA.id}/confirm`, {
      token: ctx.customerA.token,
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.booking.id, ctx.bookingA.id);

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        post(`/api/requests/${ctx.requestB}/confirm`, { token: ctx.customerB.token }),
      ),
    );
    const ids = new Set(results.map((result) => result.body.booking?.id));
    assert.deepEqual(results.map((result) => result.status), [200, 200, 200]);
    assert.equal(ids.size, 1);
    ctx.bookingB = results[0].body.booking;
  });

  it('never confirms another customer\'s request', async () => {
    assert.equal(
      (await post(`/api/requests/${ctx.requestA.id}/confirm`, { token: ctx.customerB.token })).status,
      403,
    );
    assert.equal(
      (await post(`/api/requests/${ctx.requestA.id}/confirm`, { token: ctx.provider1.token })).status,
      403,
    );
    assert.equal((await post(`/api/requests/${ctx.requestA.id}/confirm`)).status, 401);
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
    assert.equal(other.body.bookings.length, 0);

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
    const exact = await get('/api/bookings?status=confirmed', { token: ctx.customerA.token });
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

  it('shows the job in the selected provider\'s jobs list only', async () => {
    const jobs = await get('/api/provider/jobs', { token: ctx.provider1.token });
    assert.equal(jobs.status, 200);
    const job = jobs.body.jobs.find((item) => item.id === ctx.requestA.id);
    assert.ok(job);
    assert.equal(job.bookingId, ctx.bookingA.id);
    assert.equal(job.bookingStatus, 'CONFIRMED');
    assert.equal(job.amount, 1500);
    assert.equal(job.issueLabel, 'Not cooling');
    assert.equal(job.address.city, 'Bengaluru');

    const filtered = await get('/api/provider/jobs?bookingStatus=ON_THE_WAY', {
      token: ctx.provider1.token,
    });
    assert.equal(filtered.body.jobs.length, 0);

    const none = await get('/api/provider/jobs', { token: ctx.provider2.token });
    assert.equal(none.body.jobs.length, 0);

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
    assert.equal(result.body.tracking.status, 'CONFIRMED');
    assert.equal(result.body.tracking.eta, null);
    assert.equal(result.body.tracking.distance, null);
    assert.equal(result.body.tracking.lastLocation.longitude, 77.59);
    assert.equal(result.body.tracking.provider.name, 'Prakash Tech');

    assert.equal((await get(path('/tracking'), { token: ctx.customerB.token })).status, 403);
  });

  it('walks assigned → on the way → arrived once each', async () => {
    const assigned = await post(path('/assign'), { token: ctx.provider1.token });
    assert.equal(assigned.status, 200);
    assert.equal(assigned.body.booking.status, 'ASSIGNED');
    assert.ok(assigned.body.booking.timeline.technicianAssignedAt);

    const onTheWay = await post(path('/on-the-way'), { token: ctx.provider1.token });
    assert.equal(onTheWay.body.booking.status, 'ON_THE_WAY');
    assert.equal((await post(path('/on-the-way'), { token: ctx.provider1.token })).status, 409);

    const arrived = await post(path('/arrived'), { token: ctx.provider1.token });
    assert.equal(arrived.body.booking.status, 'ARRIVED');
    assert.equal((await post(path('/assign'), { token: ctx.provider1.token })).status, 409);

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

  it('does not create a ServiceRequest, Quote or Payment', async () => {
    const { default: ServiceRequest } = await import('../src/models/ServiceRequest.js');
    const { default: Quote } = await import('../src/models/Quote.js');
    const { default: Payment } = await import('../src/models/Payment.js');

    const [beforeRequests, beforeQuotes, beforePayments] = await Promise.all([
      ServiceRequest.countDocuments(),
      Quote.countDocuments(),
      Payment.countDocuments(),
    ]);

    const created = await post(path(), { token: ctx.provider1.token, body: payload() });
    assert.equal(created.status, 201);
    assert.equal(created.body.job.source, 'EXTERNAL');
    assert.equal(created.body.job.status, 'SCHEDULED');
    assert.equal(created.body.job.customer.name, 'Walk-in Customer');
    ctx.externalJobId = created.body.job.id;

    const [afterRequests, afterQuotes, afterPayments] = await Promise.all([
      ServiceRequest.countDocuments(),
      Quote.countDocuments(),
      Payment.countDocuments(),
    ]);

    assert.equal(afterRequests, beforeRequests);
    assert.equal(afterQuotes, beforeQuotes);
    assert.equal(afterPayments, beforePayments);
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

describe('payment', () => {
  const path = (suffix) => `/api/bookings/${ctx.bookingA.id}${suffix}`;

  it('is not available before completion', async () => {
    const result = await get(path('/payment'), { token: ctx.customerA.token });
    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, 'PAYMENT_NOT_DUE');

    const early = await post(path('/payment/mark-paid'), {
      token: ctx.provider1.token,
      body: { method: 'CASH' },
    });
    assert.equal(early.status, 409);
  });

  it('opens a pending payment for the accepted quote amount on completion', async () => {
    const completed = await post(`/api/requests/${ctx.requestA.id}/complete`, {
      token: ctx.provider1.token,
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.request.status, 'COMPLETED');

    const booking = await get(path(''), { token: ctx.customerA.token });
    assert.equal(booking.body.booking.status, 'COMPLETED');
    assert.ok(booking.body.booking.timeline.completedAt);

    const payment = await get(path('/payment'), { token: ctx.customerA.token });
    assert.equal(payment.status, 200);
    assert.equal(payment.body.payment.status, 'PENDING');
    assert.equal(payment.body.payment.amount, 1500);
    assert.equal(payment.body.payment.currency, 'INR');
    assert.equal(payment.body.payment.paidAt, null);

    assert.equal((await get(path('/payment'), { token: ctx.customerB.token })).status, 403);
    assert.equal((await get(path('/payment'), { token: ctx.admin.token })).status, 200);
  });

  it('never reports a payment as made without an explicit record', async () => {
    const customerClaim = await post(path('/payment/mark-paid'), {
      token: ctx.customerA.token,
      body: { method: 'CASH' },
    });
    assert.equal(customerClaim.status, 403);

    const otherProvider = await post(path('/payment/mark-paid'), {
      token: ctx.provider2.token,
      body: { method: 'CASH' },
    });
    assert.equal(otherProvider.status, 403);

    const noMethod = await post(path('/payment/mark-paid'), { token: ctx.provider1.token, body: {} });
    assert.equal(noMethod.status, 400);

    const still = await get(path('/payment'), { token: ctx.customerA.token });
    assert.equal(still.body.payment.status, 'PENDING');
  });

  it('lets the provider record a received payment once', async () => {
    const paid = await post(path('/payment/mark-paid'), {
      token: ctx.provider1.token,
      body: { method: 'upi', transactionReference: 'UPI-12345', amount: 1 },
    });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.payment.status, 'PAID');
    assert.equal(paid.body.payment.method, 'UPI');
    assert.equal(paid.body.payment.amount, 1500);
    assert.ok(paid.body.payment.paidAt);

    const twice = await post(path('/payment/mark-paid'), {
      token: ctx.provider1.token,
      body: { method: 'CASH' },
    });
    assert.equal(twice.status, 409);

    const closed = await patch(path('/location'), {
      token: ctx.provider1.token,
      body: { latitude: 1, longitude: 1 },
    });
    assert.equal(closed.status, 409);
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

  it('keeps the plain V1 flow (no confirm) working', async () => {
    const created = await post('/api/requests', {
      token: ctx.customerA.token,
      body: requestPayload(ctx.plumbing.id),
    });
    const requestId = created.body.request.id;
    const quote = await post(`/api/requests/${requestId}/quotes`, {
      token: ctx.provider2.token,
      body: { amount: 400, description: 'Tap washer' },
    });
    assert.equal((await post(`/api/quotes/${quote.body.quote.id}/accept`, { token: ctx.customerA.token })).status, 200);
    assert.equal(
      (await post(`/api/requests/${requestId}/schedule`, {
        token: ctx.provider2.token,
        body: { scheduledDate: dateOnly(1), scheduledTime: '15:00' },
      })).status,
      200,
    );
    assert.equal((await post(`/api/requests/${requestId}/start`, { token: ctx.provider2.token })).status, 200);
    const done = await post(`/api/requests/${requestId}/complete`, { token: ctx.provider2.token });
    assert.equal(done.status, 200);
    assert.equal(done.body.request.status, 'COMPLETED');

    const detail = await get(`/api/requests/${requestId}`, { token: ctx.customerA.token });
    assert.equal(detail.body.request.booking, null);
    assert.equal(detail.body.request.quotesCount, 1);
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
      ['GET', `/api/requests/${id}/providers`],
      ['POST', `/api/requests/${id}/confirm`],
      ['GET', `/api/requests/${id}/quotes`],
      ['POST', `/api/requests/${id}/quotes`],
      ['POST', `/api/requests/${id}/schedule`],
      ['POST', `/api/requests/${id}/start`],
      ['POST', `/api/requests/${id}/complete`],
      ['POST', `/api/quotes/${id}/accept`],
      ['POST', `/api/quotes/${id}/reject`],
      ['GET', '/api/provider/requests'],
      ['GET', `/api/provider/requests/${id}`],
      ['GET', '/api/provider/jobs'],
      ['GET', '/api/bookings'],
      ['GET', `/api/bookings/${id}`],
      ['GET', `/api/bookings/${id}/tracking`],
      ['POST', `/api/bookings/${id}/assign`],
      ['POST', `/api/bookings/${id}/on-the-way`],
      ['POST', `/api/bookings/${id}/arrived`],
      ['PATCH', `/api/bookings/${id}/location`],
      ['POST', `/api/bookings/${id}/chat`],
      ['GET', `/api/bookings/${id}/chat`],
      ['GET', `/api/bookings/${id}/messages`],
      ['POST', `/api/bookings/${id}/messages`],
      ['POST', `/api/bookings/${id}/messages/read`],
      ['GET', `/api/bookings/${id}/payment`],
      ['POST', `/api/bookings/${id}/payment/mark-paid`],
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
      ['GET', '/api/admin/quotes'],
      ['GET', `/api/admin/quotes/${id}`],
      ['POST', `/api/admin/quotes/${id}/assign`],
      ['GET', '/api/admin/bookings'],
      ['GET', `/api/admin/bookings/${id}`],
      ['GET', '/api/admin/payments'],
      ['GET', `/api/admin/payments/${id}`],
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
    assert.equal(typeof result.body.counts.openQuotes, 'number');
    assert.equal(typeof result.body.counts.activeBookings, 'number');
    assert.equal(typeof result.body.counts.completedBookings, 'number');
    assert.equal(typeof result.body.counts.pendingPayments, 'number');
    assert.equal(typeof result.body.counts.completedPayments, 'number');
    assert.ok(Array.isArray(result.body.recent.requests));
    assert.ok(Array.isArray(result.body.recent.quotes));
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
    assert.ok(Array.isArray(detail.body.quotes));
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
    assert.ok(Array.isArray(detail.body.payments));
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
    assert.equal(detail.body.quotes.length, 2);
    assert.ok(detail.body.booking);
    assert.equal(detail.body.booking.id, ctx.bookingA.id);
    assert.ok(detail.body.payment);
    assert.equal(detail.body.payment.status, 'PAID');
    assert.ok(detail.body.review);
    assert.equal(detail.body.review.rating, 4);

    assert.equal(
      (await get('/api/admin/requests/64b000000000000000000000', { token: ctx.admin.token })).status,
      404,
    );
  });

  it('admin can list and view quotes, and assign an existing quote atomically', async () => {
    const customer = await signup('CUSTOMER', 'Quote Assign Customer', '9876521001');
    const created = await post('/api/requests', {
      token: customer.token,
      body: requestPayload(ctx.acRepair.id, { issueKey: 'NOT_COOLING' }),
    });
    const requestId = created.body.request.id;

    const quoteX = await post(`/api/requests/${requestId}/quotes`, {
      token: ctx.provider1.token,
      body: { amount: 1100, description: 'Quote X' },
    });
    const quoteY = await post(`/api/requests/${requestId}/quotes`, {
      token: ctx.provider2.token,
      body: { amount: 1250, description: 'Quote Y' },
    });

    const listed = await get(`/api/admin/quotes?request=${requestId}`, { token: ctx.admin.token });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.quotes.length, 2);
    assert.ok(listed.body.quotes.every((quote) => quote.request.id === requestId));
    assert.ok(listed.body.quotes.every((quote) => quote.isSelected === false));

    const filteredByProvider = await get(`/api/admin/quotes?provider=${ctx.provider1.user.id}`, {
      token: ctx.admin.token,
    });
    assert.ok(filteredByProvider.body.quotes.some((quote) => quote.id === quoteX.body.quote.id));

    const detail = await get(`/api/admin/quotes/${quoteX.body.quote.id}`, { token: ctx.admin.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.quote.provider.id, ctx.provider1.user.id);
    assert.equal(detail.body.quote.request.customer.id, customer.user.id);
    assert.equal(detail.body.booking, null);

    // Only an admin may call the assignment endpoint.
    assert.equal(
      (await post(`/api/admin/quotes/${quoteX.body.quote.id}/assign`, { token: customer.token })).status,
      403,
    );
    assert.equal(
      (await post(`/api/admin/quotes/${quoteX.body.quote.id}/assign`, { token: ctx.provider1.token }))
        .status,
      403,
    );

    // Two admins racing to assign different quotes on the same request: exactly one wins.
    const [resultX, resultY] = await Promise.all([
      post(`/api/admin/quotes/${quoteX.body.quote.id}/assign`, { token: ctx.admin.token }),
      post(`/api/admin/quotes/${quoteY.body.quote.id}/assign`, { token: ctx.admin.token }),
    ]);
    assert.deepEqual([resultX.status, resultY.status].sort(), [200, 409]);

    const winner = resultX.status === 200 ? resultX : resultY;
    assert.equal(winner.body.request.status, 'QUOTE_ACCEPTED');
    assert.equal(winner.body.quote.status, 'ACCEPTED');
    assert.equal(winner.body.request.selectedProviderId, winner.body.quote.providerId);
    // No booking exists yet — only the customer's own confirmation step creates one.
    assert.equal(winner.body.request.booking, null);

    // The quote that just lost the race (or already won) can never be assigned again.
    assert.equal(
      (await post(`/api/admin/quotes/${quoteX.body.quote.id}/assign`, { token: ctx.admin.token })).status,
      409,
    );
    assert.equal(
      (await post(`/api/admin/quotes/${quoteY.body.quote.id}/assign`, { token: ctx.admin.token })).status,
      409,
    );

    assert.equal(
      (await post('/api/admin/quotes/64b000000000000000000000/assign', { token: ctx.admin.token }))
        .status,
      404,
    );
  });

  it('rejects assigning a quote that is not pending', async () => {
    // ctx.quote2 lost to ctx.quote1 earlier in the suite and is now REJECTED.
    const result = await post(`/api/admin/quotes/${ctx.quote2.id}/assign`, { token: ctx.admin.token });

    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'QUOTE_NOT_PENDING');
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

  it('admin can list and filter payments, and view payment detail', async () => {
    const listed = await get('/api/admin/payments', { token: ctx.admin.token });
    assert.equal(listed.status, 200);
    const paid = listed.body.payments.find((payment) => payment.bookingId === ctx.bookingA.id);
    assert.ok(paid);
    assert.equal(paid.status, 'PAID');

    const filtered = await get('/api/admin/payments?status=PAID', { token: ctx.admin.token });
    assert.equal(filtered.status, 200);
    assert.ok(filtered.body.payments.every((payment) => payment.status === 'PAID'));

    const detail = await get(`/api/admin/payments/${paid.id}`, { token: ctx.admin.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.payment.id, paid.id);

    assert.equal(
      (await get('/api/admin/payments/64b000000000000000000000', { token: ctx.admin.token })).status,
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

    const quoted = await post(`/api/requests/${requestId}/quotes`, {
      token: provider.token,
      body: { amount: 999, description: 'Fix it' },
    });
    await post(`/api/quotes/${quoted.body.quote.id}/accept`, { token: customer.token });
    const confirmed = await post(`/api/requests/${requestId}/confirm`, { token: customer.token });

    const adminBookingView = await get(`/api/admin/bookings/${confirmed.body.booking.id}`, {
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

    // Still open at creation, before any quote exists.
    const created = await post('/api/requests', {
      token: customer.token,
      body: requestPayload(ctx.acRepair.id, { issueKey: 'NOT_COOLING' }),
    });
    const openRequestView = await get(`/api/provider/requests/${created.body.request.id}`, {
      token: ctx.admin.token,
    });
    assert.equal(openRequestView.status, 200);

    // ProviderRequestDetailsPage fetches this alongside the request itself.
    const openRequestQuotes = await get(`/api/requests/${created.body.request.id}/quotes`, {
      token: ctx.admin.token,
    });
    assert.equal(openRequestQuotes.status, 200);
    assert.deepEqual(openRequestQuotes.body.quotes, []);

    // flow.requestId is already QUOTE_ACCEPTED (a real booking exists) — no longer
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
      ['POST', `/api/requests/${flow.requestId}/confirm`, {}],
      ['POST', `/api/requests/${flow.requestId}/quotes`, { amount: 100, description: 'x' }],
      ['POST', `/api/requests/${flow.requestId}/schedule`, {}],
      ['POST', `/api/requests/${flow.requestId}/start`, {}],
      ['POST', `/api/requests/${flow.requestId}/complete`, {}],
      ['POST', `/api/quotes/${flow.quoteId}/accept`, {}],
      ['POST', `/api/quotes/${flow.quoteId}/reject`, {}],
      ['POST', `/api/bookings/${flow.bookingId}/assign`, {}],
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
