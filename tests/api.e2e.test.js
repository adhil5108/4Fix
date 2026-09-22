import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  api,
  dateOnly,
  get,
  patch,
  post,
  requestPayload,
  signup,
  startTestServer,
  stopTestServer,
} from './helpers.js';

// Shared fixtures; suites below run in file order and build on each other.
const ctx = {};

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
  await startTestServer();
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

    const admin = await get('/api/bookings', { token: ctx.admin.token });
    assert.equal(admin.status, 403);
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
