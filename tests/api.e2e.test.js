import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import {
  api,
  connectSocket,
  createRequest,
  del,
  get,
  patch,
  post,
  requestPayload,
  settle,
  SHOP_LOCATION,
  signupProvider,
  startTestServer,
  stopTestServer,
  waitForEvents,
} from './helpers.js';
import cloudinary from '../src/config/cloudinary.js';

// Shared fixtures; suites below run in file order and build on each other.
// Customers are anonymous: each request carries its own access token (`request.token`).
const ctx = {};
let baseUrl;

const LOCATION = { latitude: 12.9716, longitude: 77.5946, address: 'Flat 3B, near the temple' };
const NAV_URL = 'https://www.google.com/maps/dir/?api=1&destination=12.9716,77.5946';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function seedServices() {
  const { default: Service } = await import('../src/models/Service.js');
  const { default: Category } = await import('../src/models/Category.js');

  const [ac, plumbingCategory, legacy] = await Category.create([
    { name: 'AC' },
    { name: 'Plumbing' },
    { name: 'Legacy' },
  ]);
  ctx.categories = { ac, plumbing: plumbingCategory, legacy };

  const [acRepair, plumbing] = await Service.create([
    {
      name: 'AC Repair',
      description: 'Diagnose and repair air conditioner faults.',
      categoryId: ac._id,
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
      categoryId: plumbingCategory._id,
      startingPrice: 299,
      isPopular: false,
      issues: [{ key: 'LEAKING_TAP', label: 'Leaking tap', isActive: true }],
    },
    {
      name: 'Retired Service',
      description: 'No longer offered.',
      categoryId: legacy._id,
      isActive: false,
    },
  ]);

  ctx.acRepair = acRepair;
  ctx.plumbing = plumbing;
}

async function seedUsers() {
  const { default: User } = await import('../src/models/User.js');
  const { hashPassword } = await import('../src/services/password.service.js');
  const { createAccessToken } = await import('../src/services/token.service.js');

  await User.create({
    name: 'Admin',
    username: 'admin',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'ADMIN',
  });

  // A customer account left over from before V1: it must no longer be able to sign in
  // or use a token, but admin can still see the record.
  const legacyCustomer = await User.create({
    name: 'Legacy Customer',
    username: '919876500099',
    passwordHash: await hashPassword('Password123'),
    role: 'CUSTOMER',
  });
  ctx.legacyCustomer = { user: legacyCustomer, token: createAccessToken(legacyCustomer) };

  const login = await post('/api/auth/login', {
    body: { username: 'admin', password: 'AdminPass123' },
  });
  assert.equal(login.status, 200);
  ctx.admin = { token: login.body.accessToken, user: login.body.user };
}

// Drives a request through the full V1 flow (anonymous create → provider accepts →
// start → complete). No account, quote, payment, schedule or travel step.
async function runFullFlow({ provider, complete = true, body }) {
  const request = await createRequest(body || requestPayload(ctx.acRepair.id, { issueKey: 'NOT_COOLING' }));
  const accepted = await post(`/api/requests/${request.id}/accept`, { token: provider.token });
  assert.equal(accepted.status, 200);
  const bookingId = accepted.body.booking.id;

  if (complete) {
    assert.equal((await post(`/api/requests/${request.id}/start`, { token: provider.token })).status, 200);
    assert.equal((await post(`/api/requests/${request.id}/complete`, { token: provider.token })).status, 200);
  }

  return { requestId: request.id, bookingId, token: request.token };
}

before(async () => {
  baseUrl = await startTestServer();
  await seedServices();
  await seedUsers();

  ctx.provider1 = await signupProvider('Prakash Tech', '9876500011');
  ctx.provider2 = await signupProvider('Priya Tech', '9876500012');
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
    const byCategory = await get(`/api/services?category=${ctx.categories.plumbing.id}`);
    assert.equal(byCategory.body.services.length, 1);
    assert.equal(byCategory.body.services[0].category.name, 'Plumbing');
    assert.equal(byCategory.body.services[0].categoryId, ctx.categories.plumbing.id);

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

describe('anonymous customer requests', () => {
  it('creates a request with no account or JWT and returns a one-time access token', async () => {
    const result = await post('/api/requests', {
      body: requestPayload(ctx.acRepair.id, {
        issueKey: 'not_cooling',
        address: undefined,
        location: LOCATION,
        customerId: '64b000000000000000000000',
        status: 'COMPLETED',
      }),
    });

    assert.equal(result.status, 201);
    assert.match(result.body.accessToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(result.body.request.status, 'PENDING');
    assert.equal(result.body.request.issueKey, 'NOT_COOLING');
    assert.equal(result.body.request.issueLabel, 'Not cooling');
    assert.equal(result.body.request.description, 'The unit runs but the air stays warm.');
    assert.deepEqual(result.body.request.location, { ...LOCATION, navigationUrl: NAV_URL });
    assert.equal('accessTokenHash' in result.body.request, false);
    assert.equal('customerId' in result.body.request, false);
    ctx.requestA = { ...result.body.request, token: result.body.accessToken };
  });

  it('stores only a hash of the access token, and no customer account', async () => {
    const { default: ServiceRequest } = await import('../src/models/ServiceRequest.js');
    const { default: User } = await import('../src/models/User.js');

    const raw = await ServiceRequest.collection.findOne({ _id: new (await import('mongoose')).default.Types.ObjectId(ctx.requestA.id) });
    assert.equal(raw.accessTokenHash, sha256(ctx.requestA.token));
    assert.equal(JSON.stringify(raw).includes(ctx.requestA.token), false);
    assert.equal(raw.customerId, null);
    assert.equal(await User.countDocuments({ role: 'CUSTOMER' }), 1); // only the seeded legacy account
  });

  it('accepts description only, photos, voice, and everything with automatic location', async () => {
    const photos = [
      'https://res.cloudinary.com/demo/image/upload/v1/4fix/a.png',
      'https://res.cloudinary.com/demo/image/upload/v1/4fix/b.jpg',
    ];
    const voiceNote = {
      url: 'https://res.cloudinary.com/demo/video/upload/v1/4fix/voice-notes/v.webm',
      format: 'webm',
      durationSeconds: 9,
    };

    const descriptionOnly = await createRequest(requestPayload(ctx.acRepair.id));
    assert.deepEqual(descriptionOnly.attachments, []);
    assert.equal(descriptionOnly.voiceNote, null);
    assert.equal(descriptionOnly.location, null);

    const withPhotos = await createRequest(requestPayload(ctx.acRepair.id, { attachments: photos }));
    assert.deepEqual(withPhotos.attachments, photos);

    const withVoice = await createRequest(requestPayload(ctx.acRepair.id, { voiceNote }));
    assert.deepEqual(withVoice.voiceNote, voiceNote);

    const everything = await createRequest(
      requestPayload(ctx.acRepair.id, { address: undefined, attachments: photos, voiceNote, location: LOCATION }),
    );
    assert.deepEqual(everything.attachments, photos);
    assert.deepEqual(everything.voiceNote, voiceNote);
    assert.equal(everything.location.latitude, LOCATION.latitude);
    assert.equal(everything.address, null);

    const tokens = new Set([descriptionOnly, withPhotos, withVoice, everything].map((request) => request.token));
    assert.equal(tokens.size, 4, 'every request gets its own token');

    // Cancelled so they stay out of the provider feed below.
    for (const request of [descriptionOnly, withPhotos, withVoice, everything]) {
      assert.equal(
        (await post(`/api/requests/${request.id}/cancel`, { requestToken: request.token })).status,
        200,
      );
    }
  });

  it('validates issue, description and location rules', async () => {
    for (const issueKey of ['NOPE', 'RETIRED', 'LEAKING_TAP']) {
      const result = await post('/api/requests', { body: requestPayload(ctx.acRepair.id, { issueKey }) });
      assert.equal(result.status, 400, issueKey);
    }

    const invalid = [
      requestPayload(ctx.acRepair.id, { description: '   ' }),
      requestPayload(ctx.acRepair.id, { description: 'hot' }),
      requestPayload(undefined),
      requestPayload(ctx.acRepair.id, { address: undefined }),
      requestPayload(ctx.acRepair.id, { address: { addressLine: '12 Lake View Road', city: 'B', state: 'K', pincode: '12' } }),
      requestPayload(ctx.acRepair.id, { address: undefined, location: { latitude: 91, longitude: 77 } }),
    ];

    for (const body of invalid) {
      assert.equal((await post('/api/requests', { body })).status, 400, JSON.stringify(body).slice(0, 80));
    }
  });

  it('the customer reads their own request with its token only', async () => {
    ctx.requestB = await createRequest(requestPayload(ctx.acRepair.id, { issueKey: 'MAKING_NOISE' }));
    ctx.requestOther = await createRequest(requestPayload(ctx.acRepair.id, { issueKey: 'OTHER' }));
    assert.equal(ctx.requestOther.issueLabel, 'Something else');

    const own = await get(`/api/requests/${ctx.requestA.id}`, { requestToken: ctx.requestA.token });
    assert.equal(own.status, 200);
    assert.equal(own.body.request.id, ctx.requestA.id);
    // Unassigned: no provider, so no provider phone either.
    assert.equal(own.body.request.provider, null);
    assert.equal(own.body.request.location.navigationUrl, NAV_URL);
    assert.equal(own.body.request.booking, null);

    // Another customer's token, a guessed token, or just knowing the id are all refused.
    assert.equal((await get(`/api/requests/${ctx.requestA.id}`, { requestToken: ctx.requestB.token })).status, 403);
    assert.equal((await get(`/api/requests/${ctx.requestA.id}`, { requestToken: 'x'.repeat(43) })).status, 401);
    assert.equal((await get(`/api/requests/${ctx.requestA.id}`)).status, 401);
    assert.equal((await get(`/api/requests/${ctx.requestA.id}`, { token: ctx.provider1.token })).status, 401);
    assert.equal((await get(`/api/requests/${ctx.requestA.id}`, { token: ctx.admin.token })).status, 401);
  });

  it('only the owner can cancel, once', async () => {
    const path = `/api/requests/${ctx.requestOther.id}/cancel`;
    assert.equal((await post(path, { requestToken: ctx.requestB.token })).status, 403);
    assert.equal((await post(path)).status, 401);

    const cancelled = await post(path, { requestToken: ctx.requestOther.token });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.request.status, 'CANCELLED');
    assert.equal((await post(path, { requestToken: ctx.requestOther.token })).status, 409);
  });

  it('customer accounts no longer exist: no signup, no login, legacy tokens refused', async () => {
    const signupAttempt = await post('/api/auth/customer/signup', {
      body: { name: 'Nope', phoneNumber: '9876500050', password: 'Password123', confirmPassword: 'Password123' },
    });
    assert.equal(signupAttempt.status, 404);

    const login = await post('/api/auth/login', {
      body: { username: '9876500099', password: 'Password123' },
    });
    assert.equal(login.status, 401);
    assert.equal(login.body.error.code, 'INVALID_CREDENTIALS');

    assert.equal((await get('/api/auth/me', { token: ctx.legacyCustomer.token })).status, 401);
    assert.equal((await get('/api/bookings', { token: ctx.legacyCustomer.token })).status, 401);
    assert.equal((await get('/api/requests', { token: ctx.legacyCustomer.token })).status, 404);
  });
});

describe('customer contact details', () => {
  it('requires a name and phone, with no account involved', async () => {
    const invalid = [
      { customerDetails: undefined },
      { customerDetails: null },
      { customerDetails: 'Asha 9876543210' },
      { customerDetails: { phone: '9876543210' } },
      { customerDetails: { name: '   ', phone: '9876543210' } },
      { customerDetails: { name: 'A', phone: '9876543210' } },
      { customerDetails: { name: 'x'.repeat(121), phone: '9876543210' } },
      { customerDetails: { name: 'Asha' } },
      { customerDetails: { name: 'Asha', phone: '   ' } },
      { customerDetails: { name: 'Asha', phone: '12345' } },
      { customerDetails: { name: 'Asha', phone: 'call me' } },
      { customerDetails: { name: 'Asha', phone: '0987654321' } },
      { customerDetails: { name: 'Asha', phone: 9876543210 } },
    ];

    for (const overrides of invalid) {
      const result = await post('/api/requests', { body: requestPayload(ctx.acRepair.id, overrides) });
      assert.equal(result.status, 400, JSON.stringify(overrides));
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    }
  });

  it('saves trimmed name and normalized phone on the request itself, not as a user', async () => {
    const { default: User } = await import('../src/models/User.js');
    const usersBefore = await User.countDocuments();

    const created = await createRequest(
      requestPayload(ctx.acRepair.id, { customerDetails: { name: '  Ravi Kumar ', phone: ' +91 98765-43211 ' } }),
    );
    assert.deepEqual(created.customerDetails, { name: 'Ravi Kumar', phone: '+919876543211' });
    assert.equal(await User.countDocuments(), usersBefore);

    const own = await get(`/api/requests/${created.id}`, { requestToken: created.token });
    assert.deepEqual(own.body.request.customerDetails, { name: 'Ravi Kumar', phone: '+919876543211' });

    // Contact details are not a credential: knowing them grants nothing.
    assert.equal((await get(`/api/requests/${created.id}`)).status, 401);
    assert.equal(
      (await post(`/api/requests/${created.id}/cancel`, { requestToken: ctx.requestB.token })).status,
      403,
    );
    assert.equal((await post(`/api/requests/${created.id}/cancel`, { requestToken: created.token })).status, 200);
  });

  it('the open feed and unassigned providers never see the name or phone', async () => {
    const feed = await get('/api/provider/requests', { token: ctx.provider1.token });
    const serialized = JSON.stringify(feed.body);
    assert.ok(feed.body.requests.some((request) => request.id === ctx.requestA.id));
    assert.equal(serialized.includes('Asha Customer'), false);
    assert.equal(serialized.includes('9876543210'), false);
    assert.ok(feed.body.requests.every((request) => !('customerDetails' in request) && !('customer' in request)));

    const preview = await get(`/api/provider/requests/${ctx.requestA.id}`, { token: ctx.provider2.token });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.request.customer, null);
    assert.equal(JSON.stringify(preview.body).includes('9876543210'), false);
  });

});

describe('provider signup and profile', () => {
  const base = (overrides = {}) => ({
    name: 'Shop Provider',
    phoneNumber: '9876501001',
    password: 'Password123',
    confirmPassword: 'Password123',
    shopLocation: SHOP_LOCATION,
    categories: [ctx.categories.ac.id],
    ...overrides,
  });

  it('requires a shop address at signup', async () => {
    const cases = [
      base({ shopLocation: undefined }),
      base({ shopLocation: null }),
      base({ shopLocation: 'Koramangala' }),
      base({ shopLocation: {} }),
      base({ shopLocation: { address: '   ' } }),
      base({ shopLocation: { address: 'MG' } }),
      base({ shopLocation: { address: 'x'.repeat(241) } }),
      base({ shopLocation: { address: 12345 } }),
    ];

    for (const body of cases) {
      const result = await post('/api/auth/provider/signup', { body });
      assert.equal(result.status, 400, JSON.stringify(body.shopLocation));
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    }
  });

  it('signs up with only a typed shop address — no coordinates required or invented', async () => {
    const created = await post('/api/auth/provider/signup', {
      body: base({ shopLocation: { address: '  Cool Air Services, MG Road  ' } }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.role, 'PROVIDER');
    assert.deepEqual(created.body.user.shopLocation, {
      latitude: null,
      longitude: null,
      address: 'Cool Air Services, MG Road',
    });

    // Coordinates sent at signup are ignored: registration takes the address only.
    const withCoords = await post('/api/auth/provider/signup', {
      body: base({ phoneNumber: '9876501002', shopLocation: { address: 'Corner shop, Kochi', latitude: 9.9, longitude: 76.2 } }),
    });
    assert.equal(withCoords.status, 201);
    assert.equal(withCoords.body.user.shopLocation.latitude, null);

    const login = await post('/api/auth/login', { body: { username: '9876501001', password: 'Password123' } });
    assert.equal(login.status, 200);
    const me = await get('/api/auth/me', { token: login.body.accessToken });
    assert.equal(me.body.user.shopLocation.address, 'Cool Air Services, MG Road');

    const { default: User } = await import('../src/models/User.js');
    const stored = await User.findById(created.body.user.id);
    assert.equal(stored.shopLocation.address, 'Cool Air Services, MG Road');
    assert.equal(stored.shopLocation.latitude, null);
    assert.equal(stored.shopLocation.longitude, null);

    const duplicate = await post('/api/auth/provider/signup', { body: base() });
    assert.equal(duplicate.status, 409);
  });

  it('profile editing still requires valid coordinates', async () => {
    for (const shopLocation of [
      { address: 'Address only' },
      { latitude: 91, longitude: 77.6 },
      { latitude: 12.9, longitude: -180.01 },
      { latitude: '12.9', longitude: 77.6 },
    ]) {
      const result = await patch('/api/users/me', { token: ctx.provider1.token, body: { shopLocation } });
      assert.equal(result.status, 400, JSON.stringify(shopLocation));
    }
  });

  it('updates the shop location from the profile, with validation', async () => {
    const updated = await patch('/api/users/me', {
      token: ctx.provider1.token,
      body: {
        bio: 'AC specialist',
        categories: [ctx.categories.ac.id, ctx.categories.plumbing.id, ctx.categories.legacy.id],
        experienceYears: 6,
        shopLocation: { latitude: 12.95, longitude: 77.6, address: 'MG Road' },
      },
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(
      updated.body.user.categories.map((category) => category.name),
      ['AC', 'Plumbing', 'Legacy'],
    );
    assert.deepEqual(updated.body.user.shopLocation, { latitude: 12.95, longitude: 77.6, address: 'MG Road' });

    const invalid = await patch('/api/users/me', {
      token: ctx.provider1.token,
      body: { shopLocation: { latitude: 100, longitude: 77.6 } },
    });
    assert.equal(invalid.status, 400);

    const cleared = await patch('/api/users/me', { token: ctx.provider1.token, body: { shopLocation: null } });
    assert.equal(cleared.status, 400, 'shop location cannot be removed');
  });

  it('never exposes the shop location on the public profile', async () => {
    const result = await get(`/api/providers/${ctx.provider1.user.id}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.provider.name, 'Prakash Tech');
    assert.equal(result.body.provider.bio, 'AC specialist');
    assert.equal('shopLocation' in result.body.provider, false);
    assert.equal('username' in result.body.provider, false);
    assert.equal('phoneVerifiedAt' in result.body.provider, false);
    assert.equal(JSON.stringify(result.body).includes('MG Road'), false);

    const admin = await get(`/api/admin/providers/${ctx.provider1.user.id}`, { token: ctx.admin.token });
    assert.equal(admin.body.provider.shopLocation.address, 'MG Road');

    assert.equal((await get(`/api/providers/${ctx.legacyCustomer.user.id}`)).status, 404);
  });
});

describe('provider acceptance', () => {
  it('providers see open requests without the customer\'s exact location', async () => {
    const feed = await get('/api/provider/requests', { token: ctx.provider1.token });
    assert.equal(feed.status, 200);
    const listed = feed.body.requests.find((request) => request.id === ctx.requestA.id);
    assert.ok(listed);
    assert.equal(listed.service.name, 'AC Repair');
    assert.equal('location' in listed, false);
    assert.equal('customer' in listed, false);
    assert.ok(!JSON.stringify(feed.body).includes('12.9716'));
    assert.ok(!JSON.stringify(feed.body).includes('Flat 3B'));
    assert.ok(!feed.body.requests.some((request) => request.id === ctx.requestOther.id));

    const detail = await get(`/api/provider/requests/${ctx.requestA.id}`, { token: ctx.provider2.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.request.location, null);
    assert.equal(detail.body.request.bookingId, null);
  });

  it('only providers can accept', async () => {
    const path = `/api/requests/${ctx.requestA.id}/accept`;
    assert.equal((await post(path)).status, 401);
    assert.equal((await post(path, { requestToken: ctx.requestA.token })).status, 401);
    assert.equal((await post(path, { token: ctx.admin.token })).status, 403);
    assert.equal(
      (await post('/api/requests/64b000000000000000000000/accept', { token: ctx.provider1.token })).status,
      404,
    );
  });

  it('a provider accepts: the job is created, assigned, and carries the customer location', async () => {
    const accepted = await post(`/api/requests/${ctx.requestA.id}/accept`, { token: ctx.provider1.token });

    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.request.status, 'ACCEPTED');
    assert.equal(accepted.body.request.selectedProviderId, ctx.provider1.user.id);
    assert.ok(accepted.body.request.acceptedAt);
    assert.equal(accepted.body.request.location.navigationUrl, NAV_URL);
    assert.deepEqual(accepted.body.request.customer, { name: 'Asha Customer', phone: '9876543210' });
    assert.deepEqual(accepted.body.booking.customer, { name: 'Asha Customer', phone: '9876543210' });
    assert.equal(accepted.body.booking.status, 'ASSIGNED');
    assert.equal(accepted.body.booking.requestId, ctx.requestA.id);
    assert.equal(accepted.body.booking.request.location.navigationUrl, NAV_URL);
    assert.equal(accepted.body.request.bookingId, accepted.body.booking.id);
    assert.ok(accepted.body.booking.timeline.acceptedAt);
    assert.equal(accepted.body.booking.timeline.startedAt, null);
    for (const gone of ['arrivalCode', 'amount', 'quoteId', 'scheduledDate', 'lastLocation']) {
      assert.equal(gone in accepted.body.booking, false, gone);
    }
    ctx.bookingA = accepted.body.booking;

    const jobs = await get('/api/provider/jobs', { token: ctx.provider1.token });
    const job = jobs.body.jobs.find((item) => item.id === ctx.requestA.id);
    assert.equal(job.bookingId, ctx.bookingA.id);
    assert.equal(job.bookingStatus, 'ASSIGNED');
    assert.equal(job.location.navigationUrl, NAV_URL);
    assert.deepEqual(job.customer, { name: 'Asha Customer', phone: '9876543210' });

    const detail = await get(`/api/provider/requests/${ctx.requestA.id}`, { token: ctx.provider1.token });
    assert.equal(detail.body.request.customer.phone, '9876543210');

    const feed = await get('/api/provider/requests', { token: ctx.provider2.token });
    assert.ok(!feed.body.requests.some((request) => request.id === ctx.requestA.id));
  });

  it('the customer sees the assigned provider and their job', async () => {
    const detail = await get(`/api/requests/${ctx.requestA.id}`, { requestToken: ctx.requestA.token });
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.request.provider, { name: 'Prakash Tech', phone: '9876500011' });
    assert.equal(detail.body.request.status, 'ACCEPTED');
    assert.equal(detail.body.request.selectedProvider.id, ctx.provider1.user.id);
    assert.equal(detail.body.request.selectedProvider.name, 'Prakash Tech');
    assert.equal('shopLocation' in detail.body.request.selectedProvider, false);
    assert.equal(detail.body.request.booking.id, ctx.bookingA.id);
  });

  it('only the request\'s own token receives the assigned provider\'s phone', async () => {
    const path = `/api/requests/${ctx.requestA.id}`;
    for (const auth of [
      {},
      { requestToken: 'x'.repeat(43) },
      { requestToken: ctx.requestB.token },
      { token: ctx.provider2.token },
      { token: ctx.provider1.token },
    ]) {
      const result = await get(path, auth);
      assert.ok([401, 403].includes(result.status), JSON.stringify(Object.keys(auth)));
      assert.equal(JSON.stringify(result.body).includes('9876500011'), false);
    }

    // Provider-facing responses never carry the provider phone field.
    const feed = await get('/api/provider/requests', { token: ctx.provider2.token });
    assert.equal(JSON.stringify(feed.body).includes('9876500011'), false);
    const jobs = await get('/api/provider/jobs', { token: ctx.provider1.token });
    assert.ok(jobs.body.jobs.every((job) => !('provider' in job)));
  });

  it('a second provider gets 409 and the assignment does not change', async () => {
    const late = await post(`/api/requests/${ctx.requestA.id}/accept`, { token: ctx.provider2.token });
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'REQUEST_ALREADY_ACCEPTED');
    assert.equal(late.body.error.message, 'This job has already been accepted.');
    assert.ok(!JSON.stringify(late.body).includes('12.9716'));
    assert.ok(!JSON.stringify(late.body).includes('9876543210'));

    const view = await get(`/api/provider/requests/${ctx.requestA.id}`, { token: ctx.provider2.token });
    assert.equal(view.status, 403);
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
    const results = await Promise.all([
      post(`/api/requests/${ctx.requestB.id}/accept`, { token: ctx.provider1.token }),
      post(`/api/requests/${ctx.requestB.id}/accept`, { token: ctx.provider2.token }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);

    const winner = results.find((result) => result.status === 200);
    const { default: Booking } = await import('../src/models/Booking.js');
    const bookings = await Booking.find({ requestId: ctx.requestB.id });
    assert.equal(bookings.length, 1);
    assert.equal(String(bookings[0].providerId), winner.body.request.selectedProviderId);

    ctx.bookingB = winner.body.booking;
    ctx.bookingBProvider = [ctx.provider1, ctx.provider2].find(
      (provider) => provider.user.id === winner.body.request.selectedProviderId,
    );
    ctx.bookingBOther = ctx.bookingBProvider === ctx.provider1 ? ctx.provider2 : ctx.provider1;
  });

  it('cancelled requests cannot be accepted, and accepted ones cannot be cancelled', async () => {
    const cancelled = await post(`/api/requests/${ctx.requestOther.id}/accept`, { token: ctx.provider1.token });
    assert.equal(cancelled.status, 409);
    assert.equal(cancelled.body.error.code, 'REQUEST_NOT_OPEN');

    const cancelAccepted = await post(`/api/requests/${ctx.requestA.id}/cancel`, {
      requestToken: ctx.requestA.token,
    });
    assert.equal(cancelAccepted.status, 409);
  });

  it('quotes, payments, scheduling, travel steps and provider live location are gone', async () => {
    const { default: mongoose } = await import('mongoose');
    assert.equal(mongoose.modelNames().includes('Quote'), false);
    assert.equal(mongoose.modelNames().includes('Payment'), false);

    const removed = [
      ['POST', `/api/requests/${ctx.requestA.id}/quotes`, { token: ctx.provider1.token }],
      ['POST', `/api/requests/${ctx.requestA.id}/confirm`, { requestToken: ctx.requestA.token }],
      ['POST', `/api/requests/${ctx.requestA.id}/schedule`, { token: ctx.provider1.token }],
      ['POST', `/api/bookings/${ctx.bookingA.id}/assign`, { token: ctx.provider1.token }],
      ['POST', `/api/bookings/${ctx.bookingA.id}/on-the-way`, { token: ctx.provider1.token }],
      ['POST', `/api/bookings/${ctx.bookingA.id}/arrived`, { token: ctx.provider1.token }],
      ['PATCH', `/api/bookings/${ctx.bookingA.id}/location`, { token: ctx.provider1.token }],
      ['GET', `/api/bookings/${ctx.bookingA.id}/tracking`, { requestToken: ctx.requestA.token }],
      ['GET', `/api/bookings/${ctx.bookingA.id}/payment`, { requestToken: ctx.requestA.token }],
      ['GET', '/api/admin/quotes', { token: ctx.admin.token }],
      ['GET', '/api/admin/payments', { token: ctx.admin.token }],
    ];

    for (const [method, path, auth] of removed) {
      const body = method === 'GET' ? undefined : { latitude: 1, longitude: 1 };
      assert.equal((await api(method, path, { ...auth, body })).status, 404, `${method} ${path}`);
    }
  });
});

describe('customer job access', () => {
  it('the customer reaches their own job with their request token', async () => {
    const list = await get('/api/bookings', { requestToken: ctx.requestA.token });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.bookings.map((booking) => booking.id), [ctx.bookingA.id]);

    const own = await get(`/api/bookings/${ctx.bookingA.id}`, { requestToken: ctx.requestA.token });
    assert.equal(own.status, 200);
    assert.equal(own.body.booking.provider.name, 'Prakash Tech');
    assert.equal(own.body.booking.status, 'ASSIGNED');
    assert.equal(own.body.booking.request.location.latitude, LOCATION.latitude);
    assert.equal('arrivalCode' in own.body.booking, false);
  });

  it('nobody else reaches it', async () => {
    const path = `/api/bookings/${ctx.bookingA.id}`;
    assert.equal((await get(path, { requestToken: ctx.requestB.token })).status, 403);
    assert.equal((await get(path, { requestToken: ctx.requestOther.token })).status, 403);
    assert.equal((await get(path)).status, 401);
    assert.equal((await get(path, { token: ctx.provider2.token })).status, 403);
    assert.equal((await get(path, { token: ctx.provider1.token })).status, 200);
    assert.equal((await get(path, { token: ctx.admin.token })).status, 200);
    assert.equal((await get('/api/bookings/not-an-id', { requestToken: ctx.requestA.token })).status, 400);

    const otherList = await get('/api/bookings', { requestToken: ctx.requestOther.token });
    assert.deepEqual(otherList.body.bookings, []);
  });

  it('providers list only their own jobs; admin gets an empty list', async () => {
    const mine = await get('/api/bookings', { token: ctx.provider1.token });
    assert.ok(mine.body.bookings.some((booking) => booking.id === ctx.bookingA.id));
    assert.ok(mine.body.bookings.every((booking) => booking.status));

    const theirs = await get('/api/bookings', { token: ctx.provider2.token });
    assert.ok(!theirs.body.bookings.some((booking) => booking.id === ctx.bookingA.id));

    const upcoming = await get('/api/bookings?status=UPCOMING', { token: ctx.provider1.token });
    assert.ok(upcoming.body.bookings.every((booking) => booking.status === 'ASSIGNED'));
    assert.equal((await get('/api/bookings?status=ON_THE_WAY', { token: ctx.provider1.token })).status, 400);

    const admin = await get('/api/bookings', { token: ctx.admin.token });
    assert.deepEqual(admin.body.bookings, []);
  });
});

describe('chat', () => {
  const path = (suffix) => `/api/bookings/${ctx.bookingA.id}${suffix}`;

  it('is only reachable by the two participants', async () => {
    assert.equal((await post(path('/chat'), { requestToken: ctx.requestB.token })).status, 403);
    assert.equal((await post(path('/chat'), { token: ctx.provider2.token })).status, 403);
    assert.equal((await post(path('/chat'))).status, 401);
    assert.equal(
      (await post(path('/messages'), { requestToken: ctx.requestB.token, body: { message: 'hi' } })).status,
      403,
    );
    assert.equal((await get(path('/messages'), { requestToken: ctx.requestB.token })).status, 403);
    assert.equal((await get(path('/messages'), { token: ctx.provider2.token })).status, 403);
  });

  it('creates one conversation shared by both sides', async () => {
    const notYet = await get(path('/chat'), { requestToken: ctx.requestA.token });
    assert.equal(notYet.status, 404);

    const opened = await post(path('/chat'), { requestToken: ctx.requestA.token });
    assert.equal(opened.status, 200);
    assert.equal(opened.body.conversation.bookingId, ctx.bookingA.id);
    assert.equal(opened.body.conversation.unreadCount, 0);

    const providerSide = await post(path('/chat'), { token: ctx.provider1.token });
    assert.equal(providerSide.body.conversation.id, opened.body.conversation.id);
    assert.deepEqual(providerSide.body.conversation.customer, { name: 'Asha Customer' });
    assert.equal(JSON.stringify(providerSide.body).includes('9876543210'), false);
  });

  it('sends, lists and marks messages read, identifying sides by role', async () => {
    const empty = await post(path('/messages'), { requestToken: ctx.requestA.token, body: { message: '  ' } });
    assert.equal(empty.status, 400);

    const sent = await post(path('/messages'), {
      requestToken: ctx.requestA.token,
      body: { message: 'Please call when you reach the gate.' },
    });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.message.isMine, true);
    assert.equal(sent.body.message.senderRole, 'CUSTOMER');
    assert.equal(sent.body.message.senderId, null);

    const reply = await post(path('/messages'), {
      token: ctx.provider1.token,
      body: { message: 'Will do, 10 minutes away.' },
    });
    assert.equal(reply.status, 201);
    assert.equal(reply.body.message.senderRole, 'PROVIDER');

    const providerList = await get(path('/messages'), { token: ctx.provider1.token });
    assert.equal(providerList.body.messages.length, 2);
    assert.equal(providerList.body.messages[0].isMine, false);
    assert.equal(providerList.body.messages[1].isMine, true);

    const unread = await get(path('/chat'), { token: ctx.provider1.token });
    assert.equal(unread.body.conversation.unreadCount, 1);

    const read = await post(path('/messages/read'), { token: ctx.provider1.token });
    assert.equal(read.body.updatedCount, 1);

    const customerList = await get(path('/messages'), { requestToken: ctx.requestA.token });
    assert.ok(customerList.body.messages[0].readAt);
    assert.equal(customerList.body.messages[0].isMine, true);
    assert.equal(customerList.body.messages[1].readAt, null);

    const customerUnread = await get(path('/chat'), { requestToken: ctx.requestA.token });
    assert.equal(customerUnread.body.conversation.unreadCount, 1);

    const since = await get(
      path(`/messages?since=${encodeURIComponent(customerList.body.messages[0].createdAt)}`),
      { requestToken: ctx.requestA.token },
    );
    assert.equal(since.body.messages.length, 1);
  });

  it('another customer can never read or join this conversation', async () => {
    const other = await get(path('/messages'), { requestToken: ctx.requestB.token });
    assert.equal(other.status, 403);
    assert.equal(JSON.stringify(other.body).includes('gate'), false);
  });
});

describe('unread chat notifications', () => {
  const sockets = [];
  const open = async (auth) => {
    const socket = await connectSocket(auth);
    sockets.push(socket);
    return socket;
  };
  const unreadEvents = (socket) =>
    socket.events.filter((item) => item.event === 'chat:unread').map((item) => item.payload);
  const say = (bookingId, auth, message) =>
    post(`/api/bookings/${bookingId}/messages`, { ...auth, body: { message } });
  const markRead = (bookingId, auth) => post(`/api/bookings/${bookingId}/messages/read`, auth);
  const summary = (auth) => get('/api/bookings/unread', auth);
  const join = (socket, bookingId) =>
    new Promise((resolve) => socket.emit('conversation:join', { bookingId }, resolve));

  // A provider with two live jobs (two customers), plus an unrelated provider/customer.
  before(async () => {
    ctx.ravi = await signupProvider('Ravi Tech', '9876500031');
    ctx.jobOne = await runFullFlow({ provider: ctx.ravi, complete: false });
    ctx.jobTwo = await runFullFlow({
      provider: ctx.ravi,
      complete: false,
      body: requestPayload(ctx.plumbing.id, {
        issueKey: 'LEAKING_TAP',
        customerDetails: { name: 'Bina Customer', phone: '98765 43211' },
      }),
    });
    ctx.otherJob = await runFullFlow({ provider: ctx.provider2, complete: false });
  });

  after(() => {
    for (const socket of sockets) {
      socket.disconnect();
    }
  });

  const ravi = () => ({ token: ctx.ravi.token });
  const customerOne = () => ({ requestToken: ctx.jobOne.token });
  const customerTwo = () => ({ requestToken: ctx.jobTwo.token });

  it('starts with no unread messages', async () => {
    const result = await summary(ravi());
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { total: 0, conversations: [] });
    assert.deepEqual((await summary(customerOne())).body, { total: 0, conversations: [] });
  });

  it('customer → provider: the provider gets unread state outside the conversation', async () => {
    // Connected, but NOT joined to the conversation (e.g. on the dashboard).
    const providerSocket = await open({ token: ctx.ravi.token });
    const customerSocket = await open({ requestToken: ctx.jobOne.token });

    assert.equal((await say(ctx.jobOne.bookingId, customerOne(), 'Is 5pm okay?')).status, 201);

    const [event] = await waitForEvents(providerSocket, 'chat:unread');
    assert.equal(event.bookingId, ctx.jobOne.bookingId);
    assert.equal(event.unreadCount, 1);
    assert.equal(event.message.senderRole, 'CUSTOMER');
    assert.equal(event.message.senderName, 'Asha Customer');
    assert.ok(event.message.id);
    // The notification carries no message text and no phone number.
    assert.equal(JSON.stringify(event).includes('5pm'), false);
    assert.equal(JSON.stringify(event).includes('98765'), false);

    const result = await summary(ravi());
    assert.equal(result.body.total, 1);
    assert.deepEqual(
      result.body.conversations.map(({ bookingId, unreadCount }) => ({ bookingId, unreadCount })),
      [{ bookingId: ctx.jobOne.bookingId, unreadCount: 1 }],
    );

    // The sender's own message is never unread for them.
    await settle();
    assert.equal(unreadEvents(customerSocket).length, 0);
    assert.equal((await summary(customerOne())).body.total, 0);
  });

  it('provider → customer: the customer gets unread state with their request token', async () => {
    const customerSocket = await open({ requestToken: ctx.jobOne.token });

    assert.equal((await say(ctx.jobOne.bookingId, ravi(), 'Yes, see you at 5.')).status, 201);

    const [event] = await waitForEvents(customerSocket, 'chat:unread');
    assert.equal(event.bookingId, ctx.jobOne.bookingId);
    assert.equal(event.unreadCount, 1);
    assert.equal(event.message.senderRole, 'PROVIDER');
    assert.equal(event.message.senderName, 'Ravi Tech');

    const result = await summary(customerOne());
    assert.equal(result.body.total, 1);
    assert.equal(result.body.conversations[0].bookingId, ctx.jobOne.bookingId);
  });

  it('multiple messages produce the expected absolute unread count', async () => {
    const providerSocket = await open({ token: ctx.ravi.token });

    for (const text of ['One more thing', 'The gate code is 42', 'Thanks!']) {
      assert.equal((await say(ctx.jobOne.bookingId, customerOne(), text)).status, 201);
    }

    const events = await waitForEvents(providerSocket, 'chat:unread', 3);
    assert.deepEqual(events.map((event) => event.unreadCount), [2, 3, 4]);
    assert.equal(new Set(events.map((event) => event.message.id)).size, 3);
    assert.equal((await summary(ravi())).body.total, 4);
  });

  it('reading one conversation does not clear another', async () => {
    assert.equal((await say(ctx.jobTwo.bookingId, customerTwo(), 'Tap is still dripping')).status, 201);
    assert.equal((await say(ctx.jobTwo.bookingId, customerTwo(), 'Please bring a washer')).status, 201);

    const before = await summary(ravi());
    const counts = Object.fromEntries(before.body.conversations.map((item) => [item.bookingId, item.unreadCount]));
    assert.deepEqual(counts, { [ctx.jobOne.bookingId]: 4, [ctx.jobTwo.bookingId]: 2 });
    assert.equal(before.body.total, 6);

    const providerSocket = await open({ token: ctx.ravi.token });
    assert.equal((await markRead(ctx.jobOne.bookingId, ravi())).body.updatedCount, 4);
    const [cleared] = await waitForEvents(providerSocket, 'chat:unread');
    assert.equal(cleared.bookingId, ctx.jobOne.bookingId);

    const after = await summary(ravi());
    assert.deepEqual(
      after.body.conversations.map(({ bookingId, unreadCount }) => ({ bookingId, unreadCount })),
      [{ bookingId: ctx.jobTwo.bookingId, unreadCount: 2 }],
    );
    assert.equal(after.body.total, 2);

    // Each customer only ever sees their own request's conversation.
    assert.deepEqual((await summary(customerTwo())).body, { total: 0, conversations: [] });
  });

  it('opening a conversation marks it read, pushes the cleared count and the read receipt', async () => {
    const customerSocket = await open({ requestToken: ctx.jobOne.token });
    const providerSocket = await open({ token: ctx.ravi.token });
    // The provider is viewing the chat, so the existing in-room read receipt applies.
    assert.equal((await join(providerSocket, ctx.jobOne.bookingId)).ok, true);

    const read = await markRead(ctx.jobOne.bookingId, customerOne());
    assert.equal(read.status, 200);
    assert.equal(read.body.updatedCount, 1);

    const [cleared] = await waitForEvents(customerSocket, 'chat:unread');
    assert.deepEqual(cleared, {
      bookingId: ctx.jobOne.bookingId,
      conversationId: cleared.conversationId,
      unreadCount: 0,
      message: null,
    });
    const [receipt] = await waitForEvents(providerSocket, 'messages:read');
    assert.deepEqual(receipt, { bookingId: ctx.jobOne.bookingId, readBy: 'CUSTOMER' });
    assert.equal((await summary(customerOne())).body.total, 0);

    // Reading their side leaves the provider's own unread (job two) untouched.
    assert.equal((await summary(ravi())).body.total, 2);
  });

  it('unread state survives a disconnect, refresh and reconnect', async () => {
    const first = await open({ requestToken: ctx.jobOne.token });
    first.disconnect();

    // Messages arrive while the customer has no connection at all.
    assert.equal((await say(ctx.jobOne.bookingId, ravi(), 'Running 10 minutes late')).status, 201);

    const afterRefresh = await summary(customerOne());
    assert.equal(afterRefresh.body.total, 1);

    const reconnected = await open({ requestToken: ctx.jobOne.token });
    assert.equal((await say(ctx.jobOne.bookingId, ravi(), 'Almost there')).status, 201);
    const [event] = await waitForEvents(reconnected, 'chat:unread');
    assert.equal(event.unreadCount, 2);
    assert.equal((await summary(customerOne())).body.total, 2);

    assert.equal((await markRead(ctx.jobOne.bookingId, customerOne())).body.updatedCount, 2);
    assert.equal((await summary(customerOne())).body.total, 0);
  });

  it('repeated delivery never double-counts: counts are absolute and reads idempotent', async () => {
    // Two tabs of the same provider; one joins the room twice (e.g. a reconnect re-join).
    const tabA = await open({ token: ctx.ravi.token });
    const tabB = await open({ token: ctx.ravi.token });
    assert.equal((await join(tabB, ctx.jobTwo.bookingId)).ok, true);
    assert.equal((await join(tabB, ctx.jobTwo.bookingId)).ok, true);

    assert.equal((await say(ctx.jobTwo.bookingId, customerTwo(), 'Are you coming today?')).status, 201);

    const [eventA] = await waitForEvents(tabA, 'chat:unread');
    const [eventB] = await waitForEvents(tabB, 'chat:unread');
    await settle();
    // Same message, same absolute count, in both tabs — applying it twice changes nothing.
    assert.deepEqual(eventA, eventB);
    assert.equal(eventA.unreadCount, 3);
    assert.equal(tabB.events.filter((item) => item.event === 'message:new').length, 1);
    assert.equal(unreadEvents(tabB).length, 1);

    assert.equal((await markRead(ctx.jobTwo.bookingId, ravi())).body.updatedCount, 3);
    const repeated = await markRead(ctx.jobTwo.bookingId, ravi());
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.updatedCount, 0);
    await settle();
    // One "cleared" event for the real read, none for the no-op repeat.
    assert.deepEqual(unreadEvents(tabA).map((event) => event.unreadCount), [3, 0]);
    assert.equal((await summary(ravi())).body.total, 0);
  });

  it("never exposes or changes another participant's unread state", async () => {
    const outsider = await open({ token: ctx.provider2.token });
    const otherCustomer = await open({ requestToken: ctx.otherJob.token });

    assert.equal((await say(ctx.jobTwo.bookingId, customerTwo(), 'Hello again')).status, 201);
    await settle();
    assert.equal(unreadEvents(outsider).length, 0);
    assert.equal(unreadEvents(otherCustomer).length, 0);

    // Another provider / another customer: the summary lists only their own conversations…
    const outsiderSummary = await summary({ token: ctx.provider2.token });
    assert.equal(outsiderSummary.status, 200);
    assert.equal(
      outsiderSummary.body.conversations.some((item) => item.bookingId === ctx.jobTwo.bookingId),
      false,
    );
    assert.deepEqual((await summary({ requestToken: ctx.otherJob.token })).body, { total: 0, conversations: [] });

    // …and they can neither mark this conversation read nor join its room.
    assert.equal((await markRead(ctx.jobTwo.bookingId, { token: ctx.provider2.token })).status, 403);
    assert.equal((await markRead(ctx.jobTwo.bookingId, { requestToken: ctx.otherJob.token })).status, 403);
    assert.equal((await join(outsider, ctx.jobTwo.bookingId)).ok, false);
    assert.equal((await join(otherCustomer, ctx.jobTwo.bookingId)).ok, false);
    assert.equal((await summary(ravi())).body.total, 1);

    // No credentials, or a forged token: refused.
    assert.equal((await summary({})).status, 401);
    assert.equal((await summary({ requestToken: 'x'.repeat(43) })).status, 401);
  });

  it('admin gets no unread behaviour, even while watching the conversation', async () => {
    const adminSocket = await open({ token: ctx.admin.token });
    assert.equal((await join(adminSocket, ctx.jobTwo.bookingId)).ok, true);

    assert.equal((await summary({ token: ctx.admin.token })).status, 403);
    assert.equal((await say(ctx.jobTwo.bookingId, customerTwo(), 'Admin should not be pinged')).status, 201);

    await waitForEvents(adminSocket, 'message:new');
    await settle();
    assert.equal(unreadEvents(adminSocket).length, 0);
    // Admin's read-only view never marks anything read on anyone's behalf.
    assert.equal((await markRead(ctx.jobTwo.bookingId, { token: ctx.admin.token })).status, 403);
    assert.equal((await summary(ravi())).body.total, 2);
  });
});

describe('provider job notes', () => {
  const path = (suffix) => `/api/bookings/${ctx.bookingA.id}${suffix}`;

  it('rejects access from anyone but the assigned provider', async () => {
    assert.equal((await get(path('/notes'))).status, 401);
    assert.equal((await post(path('/notes'), { body: { content: 'x' } })).status, 401);

    assert.equal((await get(path('/notes'), { requestToken: ctx.requestA.token })).status, 403);
    assert.equal(
      (await post(path('/notes'), { requestToken: ctx.requestA.token, body: { content: 'x' } })).status,
      403,
    );
    assert.equal((await get(path('/notes'), { token: ctx.admin.token })).status, 403);
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
    assert.equal(first.body.note.jobId, ctx.bookingA.id);

    const second = await post(path('/notes'), {
      token: ctx.provider1.token,
      body: { content: 'Customer requested follow-up next month.' },
    });
    assert.equal(second.status, 201);

    const list = await get(path('/notes'), { token: ctx.provider1.token });
    assert.equal(list.body.notes.length, 2);
    assert.equal(list.body.notes[0].id, second.body.note.id);

    const noteId = second.body.note.id;
    const edited = await patch(path(`/notes/${noteId}`), {
      token: ctx.provider1.token,
      body: { content: 'Customer requested follow-up in two weeks.' },
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.note.content, 'Customer requested follow-up in two weeks.');

    assert.equal((await del(path(`/notes/${noteId}`), { token: ctx.provider1.token })).status, 200);
    const afterDelete = await get(path('/notes'), { token: ctx.provider1.token });
    assert.equal(afterDelete.body.notes.length, 1);
    assert.equal(afterDelete.body.notes[0].id, first.body.note.id);
  });

  it('never lets another provider or the customer edit or delete a note', async () => {
    const own = await post(path('/notes'), { token: ctx.provider1.token, body: { content: 'Ownership check.' } });
    const ownId = own.body.note.id;

    assert.equal(
      (await patch(path(`/notes/${ownId}`), { token: ctx.provider2.token, body: { content: 'hijacked' } })).status,
      403,
    );
    assert.equal((await del(path(`/notes/${ownId}`), { token: ctx.provider2.token })).status, 403);
    assert.equal(
      (await patch(path(`/notes/${ownId}`), { requestToken: ctx.requestA.token, body: { content: 'x' } })).status,
      403,
    );
    assert.equal((await del(path(`/notes/${ownId}`), { requestToken: ctx.requestA.token })).status, 403);
  });

  it('never surfaces notes through the booking responses customers and admin see', async () => {
    const customerView = await get(path(''), { requestToken: ctx.requestA.token });
    assert.equal('notes' in customerView.body.booking, false);
    assert.equal(JSON.stringify(customerView.body).includes('capacitor'), false);

    const adminView = await get(path(''), { token: ctx.admin.token });
    assert.equal('notes' in adminView.body.booking, false);
  });
});

describe('job lifecycle (ASSIGNED → IN_PROGRESS → COMPLETED)', () => {
  const start = (auth) => post(`/api/requests/${ctx.requestA.id}/start`, auth);
  const complete = (auth) => post(`/api/requests/${ctx.requestA.id}/complete`, auth);

  it('only the assigned provider moves the job, one step at a time', async () => {
    assert.equal((await complete({ token: ctx.provider1.token })).status, 409, 'cannot complete before starting');
    assert.equal((await start({ token: ctx.provider2.token })).status, 403);
    assert.equal((await start({ requestToken: ctx.requestA.token })).status, 401);
    assert.equal((await start({})).status, 401);
    assert.equal((await start({ token: ctx.admin.token })).status, 403);
  });

  it('start puts the request and job in progress, with no travel or arrival step', async () => {
    const started = await start({ token: ctx.provider1.token });
    assert.equal(started.status, 200);
    assert.equal(started.body.request.status, 'IN_PROGRESS');
    assert.equal(started.body.request.location.navigationUrl, NAV_URL);
    assert.equal((await start({ token: ctx.provider1.token })).status, 409);

    const booking = await get(`/api/bookings/${ctx.bookingA.id}`, { requestToken: ctx.requestA.token });
    assert.equal(booking.body.booking.status, 'IN_PROGRESS');
    assert.equal(booking.body.booking.requestStatus, 'IN_PROGRESS');
    assert.ok(booking.body.booking.timeline.startedAt);
    assert.deepEqual(Object.keys(booking.body.booking.timeline).sort(), ['acceptedAt', 'completedAt', 'startedAt']);

    const active = await get('/api/provider/jobs?bookingStatus=IN_PROGRESS', { token: ctx.provider1.token });
    assert.ok(active.body.jobs.some((job) => job.id === ctx.requestA.id));
  });

  it('complete closes the job', async () => {
    const completed = await complete({ token: ctx.provider1.token });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.request.status, 'COMPLETED');

    const booking = await get(`/api/bookings/${ctx.bookingA.id}`, { requestToken: ctx.requestA.token });
    assert.equal(booking.body.booking.status, 'COMPLETED');
    assert.ok(booking.body.booking.timeline.completedAt);

    assert.equal((await complete({ token: ctx.provider1.token })).status, 409);
    assert.equal((await start({ token: ctx.provider1.token })).status, 409);
  });

  it('the provider never shares a live location; the shop location stays on the profile', async () => {
    const { default: Booking } = await import('../src/models/Booking.js');
    const raw = await Booking.collection.findOne({ _id: new (await import('mongoose')).default.Types.ObjectId(ctx.bookingA.id) });
    for (const field of ['lastLocation', 'onTheWayAt', 'arrivedAt', 'arrivalCode']) {
      assert.equal(field in raw, false, field);
    }

    const me = await get('/api/auth/me', { token: ctx.provider1.token });
    assert.deepEqual(me.body.user.shopLocation, { latitude: 12.95, longitude: 77.6, address: 'MG Road' });

    // Navigation always targets the customer, never the shop.
    const jobs = await get('/api/provider/jobs', { token: ctx.provider1.token });
    const job = jobs.body.jobs.find((item) => item.id === ctx.requestA.id);
    assert.equal(job.location.navigationUrl, NAV_URL);
    assert.equal(JSON.stringify(job).includes('77.6,'), false);
  });

  it('only one of two concurrent transitions succeeds', async () => {
    const flow = await runFullFlow({ provider: ctx.provider2, complete: false });
    const results = await Promise.all([
      post(`/api/requests/${flow.requestId}/start`, { token: ctx.provider2.token }),
      post(`/api/requests/${flow.requestId}/start`, { token: ctx.provider2.token }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  });
});

describe('reviews', () => {
  const path = (suffix) => `/api/bookings/${ctx.bookingA.id}${suffix}`;

  it('validates rating and ownership', async () => {
    for (const rating of [0, 6, 4.5, '5', undefined]) {
      const result = await post(path('/review'), { requestToken: ctx.requestA.token, body: { rating } });
      assert.equal(result.status, 400, String(rating));
    }

    assert.equal((await post(path('/review'), { requestToken: ctx.requestB.token, body: { rating: 5 } })).status, 403);
    assert.equal((await post(path('/review'), { token: ctx.provider1.token, body: { rating: 5 } })).status, 403);
    assert.equal((await post(path('/review'), { token: ctx.admin.token, body: { rating: 5 } })).status, 403);
    assert.equal((await post(path('/review'), { body: { rating: 5 } })).status, 401);
    assert.equal((await get(path('/review'), { requestToken: ctx.requestA.token })).status, 404);
  });

  it('requires a completed job', async () => {
    const result = await post(`/api/bookings/${ctx.bookingB.id}/review`, {
      requestToken: ctx.requestB.token,
      body: { rating: 4 },
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'BOOKING_NOT_COMPLETED');
  });

  it('the customer reviews their completed job once; ratings aggregate', async () => {
    const created = await post(path('/review'), {
      requestToken: ctx.requestA.token,
      body: { rating: 4, comment: 'Quick and tidy.', providerId: ctx.provider2.user.id },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.review.providerId, ctx.provider1.user.id);
    assert.equal(created.body.review.rating, 4);

    const duplicate = await post(path('/review'), { requestToken: ctx.requestA.token, body: { rating: 1 } });
    assert.equal(duplicate.status, 409);

    const fetched = await get(path('/review'), { token: ctx.provider1.token });
    assert.equal(fetched.body.review.comment, 'Quick and tidy.');

    const profile = await get(`/api/providers/${ctx.provider1.user.id}`);
    assert.equal(profile.body.provider.rating, 4);
    assert.equal(profile.body.provider.reviewCount, 1);
    assert.equal(profile.body.provider.completedJobs, 1);

    const reviews = await get(`/api/providers/${ctx.provider1.user.id}/reviews`);
    assert.equal(reviews.body.summary.reviewCount, 1);
    assert.equal(reviews.body.reviews[0].customer, null);
  });

  it('a customer cannot review someone else\'s job', async () => {
    const flow = await runFullFlow({ provider: ctx.provider1 });
    const stranger = await post(`/api/bookings/${flow.bookingId}/review`, {
      requestToken: ctx.requestA.token,
      body: { rating: 1 },
    });
    assert.equal(stranger.status, 403);

    const results = await Promise.all([
      post(`/api/bookings/${flow.bookingId}/review`, { requestToken: flow.token, body: { rating: 5 } }),
      post(`/api/bookings/${flow.bookingId}/review`, { requestToken: flow.token, body: { rating: 2 } }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);

    const profile = await get(`/api/providers/${ctx.provider1.user.id}`);
    assert.equal(profile.body.provider.reviewCount, 2);
    assert.equal(profile.body.provider.completedJobs, 2);
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
      address: { addressLine: '7 Direct Lane', city: 'Bengaluru', state: 'Karnataka', pincode: '560002' },
      scheduledDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      scheduledTime: '14:00',
      ...overrides,
    };
  }

  it('requires a provider JWT', async () => {
    assert.equal((await post(path(), { body: payload() })).status, 401);
    assert.equal((await post(path(), { requestToken: ctx.requestA.token, body: payload() })).status, 401);
    assert.equal((await post(path(), { token: ctx.admin.token, body: payload() })).status, 403);
  });

  it('validates required fields', async () => {
    for (const overrides of [
      { customerName: '' },
      { serviceLabel: '' },
      { description: '' },
      { address: { ...payload().address, addressLine: '' } },
      { address: { ...payload().address, pincode: '123' } },
    ]) {
      assert.equal((await post(path(), { token: ctx.provider1.token, body: payload(overrides) })).status, 400);
    }
  });

  it('creates a separate job type with no ServiceRequest or Booking', async () => {
    const { default: ServiceRequest } = await import('../src/models/ServiceRequest.js');
    const { default: Booking } = await import('../src/models/Booking.js');
    const [beforeRequests, beforeBookings] = await Promise.all([ServiceRequest.countDocuments(), Booking.countDocuments()]);

    const created = await post(path(), { token: ctx.provider1.token, body: payload() });
    assert.equal(created.status, 201);
    assert.equal(created.body.job.source, 'EXTERNAL');
    assert.equal(created.body.job.status, 'SCHEDULED');
    ctx.externalJobId = created.body.job.id;

    assert.equal(await ServiceRequest.countDocuments(), beforeRequests);
    assert.equal(await Booking.countDocuments(), beforeBookings);

    const jobs = await get('/api/provider/jobs', { token: ctx.provider1.token });
    assert.equal(jobs.body.jobs.find((job) => job.id === ctx.externalJobId).source, 'EXTERNAL');
    assert.equal(jobs.body.jobs.find((job) => job.id === ctx.requestA.id).source, '4FIX');
  });

  it('walks its own lifecycle, keeps notes, and stays private to its provider', async () => {
    const id = ctx.externalJobId;
    const updated = await patch(path(`/${id}`), { token: ctx.provider1.token, body: payload({ customerName: 'Renamed' }) });
    assert.equal(updated.body.job.customer.name, 'Renamed');

    assert.equal((await post(path(`/${id}/complete`), { token: ctx.provider1.token })).status, 409);
    for (const [step, status] of [['on-the-way', 'ON_THE_WAY'], ['arrived', 'ARRIVED'], ['start', 'IN_PROGRESS'], ['complete', 'COMPLETED']]) {
      const result = await post(path(`/${id}/${step}`), { token: ctx.provider1.token });
      assert.equal(result.body.job.status, status);
    }

    const note = await post(path(`/${id}/notes`), { token: ctx.provider1.token, body: { content: 'Spare capacitor used.' } });
    assert.equal(note.status, 201);
    assert.equal(note.body.note.jobId, id);

    assert.equal((await get(path(`/${id}`), { token: ctx.provider2.token })).status, 404);
    assert.equal((await get(path(`/${id}/notes`), { token: ctx.provider2.token })).status, 404);
    assert.equal((await get(path(`/${id}`), { requestToken: ctx.requestA.token })).status, 401);

    assert.equal((await del(path(`/${id}`), { token: ctx.provider1.token })).status, 200);
    assert.equal((await get(path(`/${id}`), { token: ctx.provider1.token })).status, 404);
  });
});

describe('authorization', () => {
  it('anonymous customers (with or without a request token) cannot reach provider or admin routes', async () => {
    const routes = [
      ['GET', '/api/provider/requests'],
      ['GET', `/api/provider/requests/${ctx.requestA.id}`],
      ['GET', '/api/provider/jobs'],
      ['GET', '/api/provider/external-jobs/64b000000000000000000000'],
      ['POST', `/api/requests/${ctx.requestA.id}/accept`],
      ['POST', `/api/requests/${ctx.requestA.id}/start`],
      ['PATCH', '/api/users/me'],
      ['GET', '/api/auth/me'],
      ['GET', '/api/admin/dashboard'],
      ['GET', '/api/admin/requests'],
      ['GET', `/api/admin/requests/${ctx.requestA.id}`],
      ['GET', '/api/admin/providers'],
    ];

    for (const [method, path] of routes) {
      assert.equal((await api(method, path)).status, 401, `${method} ${path} (anonymous)`);
      assert.equal(
        (await api(method, path, { requestToken: ctx.requestA.token })).status,
        401,
        `${method} ${path} (request token)`,
      );
    }
  });

  it('a provider cannot reach another provider\'s job', async () => {
    const path = `/api/bookings/${ctx.bookingB.id}`;
    assert.equal((await get(path, { token: ctx.bookingBOther.token })).status, 403);
    assert.equal((await get(`${path}/notes`, { token: ctx.bookingBOther.token })).status, 403);
    assert.equal((await get(`${path}/messages`, { token: ctx.bookingBOther.token })).status, 403);
    assert.equal(
      (await post(`/api/requests/${ctx.requestB.id}/start`, { token: ctx.bookingBOther.token })).status,
      403,
    );

    const jobs = await get('/api/provider/jobs', { token: ctx.bookingBOther.token });
    assert.ok(!jobs.body.jobs.some((job) => job.id === ctx.requestB.id));
  });

  it('returns 401 for every protected endpoint without credentials', async () => {
    const id = '64b000000000000000000000';
    const endpoints = [
      ['GET', `/api/requests/${id}`],
      ['POST', `/api/requests/${id}/cancel`],
      ['POST', `/api/requests/${id}/accept`],
      ['POST', `/api/requests/${id}/start`],
      ['POST', `/api/requests/${id}/complete`],
      ['GET', '/api/provider/requests'],
      ['GET', `/api/provider/requests/${id}`],
      ['GET', '/api/provider/jobs'],
      ['GET', '/api/bookings'],
      ['GET', `/api/bookings/${id}`],
      ['POST', `/api/bookings/${id}/chat`],
      ['GET', `/api/bookings/${id}/chat`],
      ['GET', `/api/bookings/${id}/messages`],
      ['POST', `/api/bookings/${id}/messages`],
      ['POST', `/api/bookings/${id}/messages/read`],
      ['POST', `/api/bookings/${id}/review`],
      ['GET', `/api/bookings/${id}/review`],
      ['GET', `/api/bookings/${id}/notes`],
      ['PATCH', '/api/users/me'],
      ['GET', '/api/auth/me'],
    ];

    for (const [method, path] of endpoints) {
      assert.equal((await api(method, path)).status, 401, `${method} ${path}`);
    }
  });

  it('keeps public endpoints public, including creating a request', async () => {
    assert.equal((await get('/api/services')).status, 200);
    assert.equal((await get(`/api/providers/${ctx.provider1.user.id}`)).status, 200);
    assert.equal((await get(`/api/providers/${ctx.provider1.user.id}/reviews`)).status, 200);
    assert.equal((await post('/api/requests', { body: requestPayload(ctx.plumbing.id) })).status, 201);
  });

  it('rate-limits anonymous callers per IP, but not authenticated providers', async () => {
    const { rateLimit } = await import('../src/middleware/rateLimit.js');
    const limiter = rateLimit({ name: 'test', max: 2, windowMs: 60000 });
    const run = (req) => new Promise((resolve) => limiter(req, {}, (error) => resolve(error?.statusCode ?? 200)));

    const anonymous = { ip: '10.0.0.1' };
    assert.deepEqual([await run(anonymous), await run(anonymous), await run(anonymous)], [200, 200, 429]);
    assert.equal(await run({ ip: '10.0.0.2' }), 200, 'limits are per IP');
    assert.equal(await run({ ip: '10.0.0.1', user: { role: 'PROVIDER' } }), 200);
  });

  it('a malformed or forged JWT is refused rather than treated as anonymous', async () => {
    assert.equal((await get('/api/provider/jobs', { token: 'not-a-jwt' })).status, 401);
    assert.equal((await get(`/api/bookings/${ctx.bookingA.id}`, { token: 'not-a-jwt' })).status, 401);
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
  it('anonymous customers can upload (they have no account); a bad JWT is still refused', async () => {
    const result = await uploadRequest({ omitFile: true });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'IMAGE_REQUIRED');

    assert.equal((await uploadRequest({ token: 'not-a-jwt' })).status, 401);
  });

  it('rejects non-image file types and files over 5MB', async () => {
    const wrongType = await uploadRequest({ mimeType: 'text/plain', filename: 'notes.txt' });
    assert.equal(wrongType.status, 400);
    assert.equal(wrongType.body.error.code, 'INVALID_FILE_TYPE');

    const oversized = await uploadRequest({ bytes: new Uint8Array(5 * 1024 * 1024 + 1024) });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.error.code, 'FILE_TOO_LARGE');
  });

  it('uploads successfully for anonymous customers and providers', async () => {
    const restore = mockCloudinaryUpload(async () => ({
      secure_url: 'https://res.cloudinary.com/demo/image/upload/v1700000000/4fix/abc123.png',
      public_id: '4fix/abc123',
      width: 800,
      height: 600,
      format: 'png',
    }));

    try {
      const anonymous = await uploadRequest();
      assert.equal(anonymous.status, 201);
      assert.deepEqual(anonymous.body.image, {
        url: 'https://res.cloudinary.com/demo/image/upload/v1700000000/4fix/abc123.png',
        publicId: '4fix/abc123',
        width: 800,
        height: 600,
        format: 'png',
      });

      assert.equal((await uploadRequest({ token: ctx.provider1.token })).status, 201);
    } finally {
      restore();
    }
  });

  it('handles Cloudinary failures without leaking secrets', async () => {
    const restore = mockCloudinaryUpload(async () => {
      throw new Error('Cloudinary rejected the upload: invalid api_secret');
    });

    try {
      const result = await uploadRequest();
      assert.equal(result.status, 502);
      assert.equal(result.body.error.code, 'UPLOAD_FAILED');
      assert.equal(/api[_-]?secret/i.test(JSON.stringify(result.body)), false);
    } finally {
      restore();
    }
  });
});

async function uploadAudioRequest({ token, mimeType = 'audio/webm', filename = 'note.webm', bytes, omitFile = false } = {}) {
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
  it('the audio upload is for customers only (providers/admin refused)', async () => {
    assert.equal((await uploadAudioRequest({ token: ctx.provider1.token })).status, 403);
    assert.equal((await uploadAudioRequest({ token: ctx.admin.token })).status, 403);
  });

  it('validates the audio file', async () => {
    const missing = await uploadAudioRequest({ omitFile: true });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, 'AUDIO_REQUIRED');

    const wrongType = await uploadAudioRequest({ mimeType: 'text/plain', filename: 'notes.txt' });
    assert.equal(wrongType.body.error.code, 'INVALID_FILE_TYPE');

    const oversized = await uploadAudioRequest({ bytes: new Uint8Array(10 * 1024 * 1024 + 1024) });
    assert.equal(oversized.status, 413);
  });

  it('uploads anonymously and returns asset info', async () => {
    const restore = mockCloudinaryUpload(async () => ({
      secure_url: 'https://res.cloudinary.com/demo/video/upload/v1700000000/4fix/voice-notes/abc123.webm',
      public_id: '4fix/voice-notes/abc123',
      format: 'webm',
      duration: 12.4,
    }));

    try {
      const result = await uploadAudioRequest();
      assert.equal(result.status, 201);
      assert.equal(result.body.audio.format, 'webm');
      assert.equal(result.body.audio.durationSeconds, 12.4);
    } finally {
      restore();
    }
  });

  it('rejects an invalid voice note payload on the request', async () => {
    for (const voiceNote of [
      { format: 'webm' },
      { url: 'https://res.cloudinary.com/demo/x.exe', format: 'exe' },
      { url: 'https://res.cloudinary.com/demo/x.webm', durationSeconds: -1 },
    ]) {
      assert.equal((await post('/api/requests', { body: requestPayload(ctx.acRepair.id, { voiceNote }) })).status, 400);
    }
  });

  it('is visible to providers, on the job, and in admin views', async () => {
    const provider = await signupProvider('Voice Note Provider', '9876523011');
    const voiceNote = {
      url: 'https://res.cloudinary.com/demo/video/upload/v1700000000/4fix/voice-notes/job123.webm',
      format: 'webm',
      durationSeconds: 18,
    };
    const request = await createRequest(requestPayload(ctx.acRepair.id, { issueKey: 'NOT_COOLING', voiceNote }));

    const providerView = await get(`/api/provider/requests/${request.id}`, { token: provider.token });
    assert.deepEqual(providerView.body.request.voiceNote, voiceNote);

    const adminRequestView = await get(`/api/admin/requests/${request.id}`, { token: ctx.admin.token });
    assert.deepEqual(adminRequestView.body.request.voiceNote, voiceNote);

    const accepted = await post(`/api/requests/${request.id}/accept`, { token: provider.token });
    assert.deepEqual(accepted.body.booking.request.voiceNote, voiceNote);

    const adminBookingView = await get(`/api/admin/bookings/${accepted.body.booking.id}`, { token: ctx.admin.token });
    assert.deepEqual(adminBookingView.body.booking.request.voiceNote, voiceNote);
  });
});

describe('admin', () => {
  it('every admin endpoint requires the ADMIN role', async () => {
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
      assert.equal((await api(method, path, { requestToken: ctx.requestA.token })).status, 401, `${method} ${path} (customer)`);
      assert.equal((await api(method, path, { token: ctx.provider1.token })).status, 403, `${method} ${path} (provider)`);
    }
  });

  it('admin can view the dashboard with server-aggregated counts', async () => {
    const result = await get('/api/admin/dashboard', { token: ctx.admin.token });

    assert.equal(result.status, 200);
    for (const key of ['totalProviders', 'activeProviders', 'openRequests', 'acceptedRequests', 'activeBookings', 'completedBookings']) {
      assert.equal(typeof result.body.counts[key], 'number', key);
    }
    assert.ok(Array.isArray(result.body.recent.requests));
    assert.ok(Array.isArray(result.body.recent.bookings));
  });

  it('admin can create, list, fetch and update a service', async () => {
    const pest = await post('/api/admin/categories', { token: ctx.admin.token, body: { name: 'Pest' } });
    assert.equal(pest.status, 201);
    const created = await post('/api/admin/services', {
      token: ctx.admin.token,
      body: {
        name: 'Pest Control',
        description: 'Home pest control treatment.',
        categoryId: pest.body.category.id,
        startingPrice: 799,
        issues: [
          { key: 'ants', label: 'Ants' },
          { key: 'cockroaches', label: 'Cockroaches' },
        ],
      },
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.service.category.name, 'Pest');
    assert.deepEqual(created.body.service.issues.map((issue) => issue.key), ['ANTS', 'COCKROACHES']);
    const serviceId = created.body.service.id;

    const listed = await get('/api/admin/services', { token: ctx.admin.token });
    assert.ok(listed.body.services.some((service) => service.id === serviceId));

    const updated = await patch(`/api/admin/services/${serviceId}`, {
      token: ctx.admin.token,
      body: { startingPrice: 899, isActive: false },
    });
    assert.equal(updated.body.service.isActive, false);

    const publicList = await get('/api/services');
    assert.equal(publicList.body.services.some((service) => service.id === serviceId), false);
  });

  it('rejects invalid service input and deleting a service in use', async () => {
    const missingFields = await post('/api/admin/services', {
      token: ctx.admin.token,
      body: { description: 'A short valid description.' },
    });
    assert.equal(missingFields.status, 400);

    const inUse = await api('DELETE', `/api/admin/services/${ctx.acRepair.id}`, { token: ctx.admin.token });
    assert.equal(inUse.status, 409);
    assert.equal(inUse.body.error.code, 'SERVICE_IN_USE');
  });

  it('admin can list and view providers (with shop location) and toggle active status', async () => {
    const listed = await get('/api/admin/providers', { token: ctx.admin.token });
    const row = listed.body.providers.find((provider) => provider.id === ctx.provider1.user.id);
    assert.ok(row);
    assert.equal('passwordHash' in row, false);
    assert.equal(row.shopLocation.address, 'MG Road');

    const detail = await get(`/api/admin/providers/${ctx.provider1.user.id}`, { token: ctx.admin.token });
    assert.ok(Array.isArray(detail.body.bookings));
    assert.ok(Array.isArray(detail.body.reviews));

    const temp = await signupProvider('Temp Provider', '9876519001');
    const deactivated = await patch(`/api/admin/providers/${temp.user.id}/status`, {
      token: ctx.admin.token,
      body: { isActive: false },
    });
    assert.equal(deactivated.body.provider.isActive, false);
    assert.equal((await get('/api/auth/me', { token: temp.token })).status, 401);
    assert.equal(
      (await post(`/api/requests/${ctx.requestA.id}/accept`, { token: temp.token })).status,
      401,
      'a deactivated provider cannot accept jobs',
    );
  });

  it('legacy customer accounts remain visible to admin, untouched', async () => {
    const listed = await get('/api/admin/customers', { token: ctx.admin.token });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.customers.some((customer) => customer.id === ctx.legacyCustomer.user.id));

    const detail = await get(`/api/admin/customers/${ctx.legacyCustomer.user.id}`, { token: ctx.admin.token });
    assert.equal(detail.status, 200);
    assert.equal('passwordHash' in detail.body.customer, false);
  });

  it('admin can list and view requests, including anonymous ones', async () => {
    const listed = await get('/api/admin/requests', { token: ctx.admin.token });
    const row = listed.body.requests.find((request) => request.id === ctx.requestA.id);
    assert.ok(row);
    assert.deepEqual(row.customer, { name: 'Asha Customer', phone: '9876543210' });
    assert.equal('accessTokenHash' in row, false);

    const bySearch = await get('/api/admin/requests?search=9876543210', { token: ctx.admin.token });
    assert.ok(bySearch.body.requests.some((request) => request.id === ctx.requestA.id));
    const byName = await get('/api/admin/requests?search=asha', { token: ctx.admin.token });
    assert.ok(byName.body.requests.some((request) => request.id === ctx.requestA.id));

    const filtered = await get('/api/admin/requests?status=CANCELLED', { token: ctx.admin.token });
    assert.ok(filtered.body.requests.every((request) => request.status === 'CANCELLED'));

    const detail = await get(`/api/admin/requests/${ctx.requestA.id}`, { token: ctx.admin.token });
    assert.equal(detail.body.request.status, 'COMPLETED');
    assert.equal(detail.body.request.selectedProvider.id, ctx.provider1.user.id);
    assert.equal(detail.body.request.location.latitude, LOCATION.latitude);
    assert.equal(detail.body.booking.id, ctx.bookingA.id);
    assert.equal(detail.body.review.rating, 4);
    assert.equal(JSON.stringify(detail.body).includes(ctx.requestA.token), false);
  });

  it('admin can list, filter and view bookings and reviews', async () => {
    const listed = await get('/api/admin/bookings', { token: ctx.admin.token });
    const row = listed.body.bookings.find((booking) => booking.id === ctx.bookingA.id);
    assert.equal(row.provider.id, ctx.provider1.user.id);

    const completed = await get('/api/admin/bookings?status=COMPLETED', { token: ctx.admin.token });
    assert.ok(completed.body.bookings.every((booking) => booking.status === 'COMPLETED'));

    const reviews = await get('/api/admin/reviews', { token: ctx.admin.token });
    const review = reviews.body.reviews.find((item) => item.bookingId === ctx.bookingA.id);
    assert.equal(review.rating, 4);
    assert.equal((await get(`/api/admin/reviews/${review.id}`, { token: ctx.admin.token })).status, 200);
  });

  it('admin reads any conversation but can never act in it', async () => {
    const path = (suffix) => `/api/bookings/${ctx.bookingA.id}${suffix}`;
    const messages = await get(path('/messages'), { token: ctx.admin.token });
    assert.equal(messages.status, 200);
    assert.ok(messages.body.messages.every((message) => ['CUSTOMER', 'PROVIDER'].includes(message.senderRole)));

    assert.equal((await post(path('/chat'), { token: ctx.admin.token })).status, 403);
    assert.equal((await post(path('/messages'), { token: ctx.admin.token, body: { message: 'hi' } })).status, 403);
    assert.equal((await post(path('/messages/read'), { token: ctx.admin.token })).status, 403);
  });

  it('never returns password hashes or token hashes', async () => {
    const responses = await Promise.all([
      get('/api/admin/providers', { token: ctx.admin.token }),
      get('/api/admin/customers', { token: ctx.admin.token }),
      get('/api/admin/dashboard', { token: ctx.admin.token }),
      get('/api/admin/requests', { token: ctx.admin.token }),
      get('/api/admin/bookings', { token: ctx.admin.token }),
    ]);

    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(/passwordHash|accessTokenHash/.test(JSON.stringify(response.body)), false);
    }
  });
});

describe('admin area preview (Provider View)', () => {
  it('admin sees the open feed but never private jobs or coordinates', async () => {
    const provider = await signupProvider('Preview Provider', '9876524011');
    const flow = await runFullFlow({ provider, complete: false });
    const open = await createRequest(requestPayload(ctx.acRepair.id, { address: undefined, location: LOCATION }));

    const feed = await get('/api/provider/requests', { token: ctx.admin.token });
    assert.ok(feed.body.requests.some((request) => request.id === open.id));

    const openView = await get(`/api/provider/requests/${open.id}`, { token: ctx.admin.token });
    assert.equal(openView.status, 200);
    assert.equal(openView.body.request.location, null);

    assert.equal((await get(`/api/provider/requests/${flow.requestId}`, { token: ctx.admin.token })).status, 403);
    assert.deepEqual((await get('/api/provider/jobs', { token: ctx.admin.token })).body.jobs, []);

    for (const [method, path] of [
      ['POST', `/api/requests/${flow.requestId}/accept`],
      ['POST', `/api/requests/${flow.requestId}/start`],
      ['POST', `/api/requests/${flow.requestId}/complete`],
      ['POST', `/api/requests/${flow.requestId}/cancel`],
      ['POST', `/api/bookings/${flow.bookingId}/chat`],
      ['POST', `/api/bookings/${flow.bookingId}/messages`],
      ['POST', `/api/bookings/${flow.bookingId}/review`],
    ]) {
      const result = await api(method, path, { token: ctx.admin.token, body: { message: 'hi', rating: 5 } });
      assert.ok([401, 403].includes(result.status), `${method} ${path} unexpectedly allowed (${result.status})`);
    }
  });
});

describe('customer service location', () => {
  it('builds the navigation URL from coordinates and never a broken one', async () => {
    const { buildNavigationUrl } = await import('../src/utils/location.js');
    assert.equal(buildNavigationUrl(12.9716, 77.5946), NAV_URL);
    assert.equal(
      buildNavigationUrl(-33.8688, 151.2093),
      'https://www.google.com/maps/dir/?api=1&destination=-33.8688,151.2093',
    );
    assert.equal(buildNavigationUrl(null, 77.5), null);
    assert.equal(buildNavigationUrl(12.9, undefined), null);
  });

  it('rejects invalid coordinates and malformed locations', async () => {
    for (const location of [
      { latitude: 90.0001, longitude: 77.5 },
      { latitude: -91, longitude: 77.5 },
      { latitude: '12.97', longitude: 77.5 },
      { latitude: 12.9, longitude: 180.5 },
      { latitude: 12.9, longitude: -181 },
      { latitude: 12.9 },
      [12.9, 77.5],
    ]) {
      const result = await post('/api/requests', {
        body: requestPayload(ctx.acRepair.id, { address: undefined, location }),
      });
      assert.equal(result.status, 400, JSON.stringify(location));
    }
  });

  it('accepts boundary coordinates together with a typed address', async () => {
    const both = await createRequest(requestPayload(ctx.acRepair.id, { location: { latitude: -90, longitude: 180 } }));
    assert.equal(both.address.pincode, '560001');
    assert.equal(both.location.latitude, -90);
    assert.equal(both.location.address, null);
  });

  it('shows only the area of a typed address before acceptance, the full address after', async () => {
    const provider = await signupProvider('Area Provider', '9876525011');
    const request = await createRequest(requestPayload(ctx.acRepair.id));

    const preview = await get(`/api/provider/requests/${request.id}`, { token: provider.token });
    assert.equal(preview.body.request.address.addressLine, null);
    assert.equal(preview.body.request.address.city, 'Bengaluru');

    const accepted = await post(`/api/requests/${request.id}/accept`, { token: provider.token });
    assert.equal(accepted.body.request.address.addressLine, '12 Lake View Road');
    assert.equal(accepted.body.request.location, null, 'no coordinates were shared, so none are invented');
  });

  it('requests without coordinates still work everywhere', async () => {
    const provider = await signupProvider('Legacy Location Provider', '9876525013');
    const flow = await runFullFlow({ provider, complete: false });
    const { default: ServiceRequest } = await import('../src/models/ServiceRequest.js');
    const { default: mongoose } = await import('mongoose');
    await ServiceRequest.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(flow.requestId) },
      { $unset: { location: '' } },
    );

    await ServiceRequest.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(flow.requestId) },
      { $unset: { customerDetails: '' } },
    );

    const detail = await get(`/api/requests/${flow.requestId}`, { requestToken: flow.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.request.location, null);
    assert.equal(detail.body.request.customerDetails, null);

    const providerBooking = await get(`/api/bookings/${flow.bookingId}`, { token: provider.token });
    assert.equal(providerBooking.status, 200);
    assert.equal(providerBooking.body.booking.customer, null);
    const adminView = await get(`/api/admin/requests/${flow.requestId}`, { token: ctx.admin.token });
    assert.equal(adminView.body.request.customer, null);

    const jobs = await get('/api/provider/jobs', { token: provider.token });
    assert.equal(jobs.body.jobs.find((item) => item.id === flow.requestId).location, null);
    const booking = await get(`/api/bookings/${flow.bookingId}`, { requestToken: flow.token });
    assert.equal(booking.body.booking.request.location, null);
  });
});

describe('categories', () => {
  it('admin creates, updates and lists categories; non-admins cannot', async () => {
    for (const [method, path] of [
      ['GET', '/api/admin/categories'],
      ['POST', '/api/admin/categories'],
      ['PATCH', `/api/admin/categories/${ctx.categories.ac.id}`],
      ['DELETE', `/api/admin/categories/${ctx.categories.ac.id}`],
    ]) {
      assert.equal((await api(method, path)).status, 401, `${method} ${path}`);
      assert.equal((await api(method, path, { token: ctx.provider1.token })).status, 403, `${method} ${path}`);
    }

    const created = await post('/api/admin/categories', {
      token: ctx.admin.token,
      body: { name: '  Electrical ', description: 'Wiring, fans and switches.' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.category.name, 'Electrical');
    assert.equal(created.body.category.isActive, true);
    ctx.categories.electrical = created.body.category;

    const duplicate = await post('/api/admin/categories', { token: ctx.admin.token, body: { name: 'electrical' } });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, 'CATEGORY_EXISTS');
    assert.equal((await post('/api/admin/categories', { token: ctx.admin.token, body: { name: 'x' } })).status, 400);

    const updated = await patch(`/api/admin/categories/${created.body.category.id}`, {
      token: ctx.admin.token,
      body: { description: 'Wiring, fans, switches and sockets.' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.category.description, 'Wiring, fans, switches and sockets.');

    const listed = await get('/api/admin/categories', { token: ctx.admin.token });
    const ac = listed.body.categories.find((category) => category.id === ctx.categories.ac.id);
    assert.ok(ac.serviceCount >= 1);
  });

  it('customers see only active categories, and services by category', async () => {
    const hidden = await post('/api/admin/categories', {
      token: ctx.admin.token,
      body: { name: 'Hidden Category', isActive: false },
    });
    ctx.categories.hidden = hidden.body.category;
    const service = await post('/api/admin/services', {
      token: ctx.admin.token,
      body: { name: 'Hidden Service', description: 'Not offered right now.', categoryId: hidden.body.category.id },
    });
    assert.equal(service.status, 201);

    const list = await get('/api/categories');
    assert.equal(list.status, 200);
    const names = list.body.categories.map((category) => category.name);
    assert.ok(names.includes('AC') && names.includes('Plumbing'));
    assert.equal(names.includes('Hidden Category'), false);
    assert.equal('isActive' in list.body.categories[0], false);
    assert.equal(list.body.categories.find((category) => category.name === 'AC').serviceCount, 1);

    const acServices = await get(`/api/categories/${ctx.categories.ac.id}/services`);
    assert.equal(acServices.status, 200);
    assert.equal(acServices.body.category.name, 'AC');
    assert.deepEqual(acServices.body.services.map((item) => item.name), ['AC Repair']);
    assert.equal(acServices.body.services[0].category.name, 'AC');

    // An inactive category, its services and booking them are all unavailable publicly.
    assert.equal((await get(`/api/categories/${hidden.body.category.id}/services`)).status, 404);
    assert.equal((await get(`/api/services/${service.body.service.id}`)).status, 404);
    assert.equal((await get('/api/services')).body.services.some((item) => item.name === 'Hidden Service'), false);
    assert.deepEqual((await get(`/api/services?category=${hidden.body.category.id}`)).body.services, []);
    assert.equal((await post('/api/requests', { body: requestPayload(service.body.service.id) })).status, 404);

    // Enabling it makes everything visible again.
    await patch(`/api/admin/categories/${hidden.body.category.id}`, { token: ctx.admin.token, body: { isActive: true } });
    assert.equal((await get(`/api/services/${service.body.service.id}`)).status, 200);
    await patch(`/api/admin/categories/${hidden.body.category.id}`, { token: ctx.admin.token, body: { isActive: false } });

    const empty = await get(`/api/categories/${ctx.categories.electrical.id}/services`);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.services, []);
  });

  it('every service belongs to exactly one existing category, stored by reference', async () => {
    const base = { name: 'Fan Repair', description: 'Ceiling and table fans.' };
    assert.equal((await post('/api/admin/services', { token: ctx.admin.token, body: base })).status, 400);
    assert.equal(
      (await post('/api/admin/services', {
        token: ctx.admin.token,
        body: { ...base, categoryId: '64b000000000000000000000' },
      })).status,
      400,
    );
    assert.equal(
      (await post('/api/admin/services', { token: ctx.admin.token, body: { ...base, category: 'ELECTRICAL' } })).status,
      400,
    );

    const created = await post('/api/admin/services', {
      token: ctx.admin.token,
      body: { ...base, categoryId: ctx.categories.electrical.id },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.service.categoryId, ctx.categories.electrical.id);
    assert.equal(created.body.service.category.name, 'Electrical');

    const { default: Service } = await import('../src/models/Service.js');
    const stored = await Service.findById(created.body.service.id).lean();
    assert.equal(String(stored.categoryId), ctx.categories.electrical.id);
    assert.equal('category' in stored, false, 'no free-text category name is stored');

    const cleared = await patch(`/api/admin/services/${created.body.service.id}`, {
      token: ctx.admin.token,
      body: { categoryId: null },
    });
    assert.equal(cleared.status, 400, 'a service cannot be left without a category');
  });

  it('a category with services cannot be deleted; an empty one can', async () => {
    const inUse = await del(`/api/admin/categories/${ctx.categories.ac.id}`, { token: ctx.admin.token });
    assert.equal(inUse.status, 409);
    assert.equal(inUse.body.error.code, 'CATEGORY_IN_USE');

    const temp = await post('/api/admin/categories', { token: ctx.admin.token, body: { name: 'Temporary' } });
    const provider = await signupProvider('Temp Category Provider', '9876531001', {
      categories: [temp.body.category.id, ctx.categories.ac.id],
    });
    const removed = await del(`/api/admin/categories/${temp.body.category.id}`, { token: ctx.admin.token });
    assert.equal(removed.status, 200);
    const me = await get('/api/auth/me', { token: provider.token });
    assert.deepEqual(me.body.user.categories.map((category) => category.name), ['AC']);
  });

  it('existing services and providers without categories keep working', async () => {
    const { default: Service } = await import('../src/models/Service.js');
    const { default: User } = await import('../src/models/User.js');
    const { hashPassword } = await import('../src/services/password.service.js');

    // A service stored before categories existed: free-text category, no categoryId.
    const { insertedId } = await Service.collection.insertOne({
      name: 'Old Carpentry',
      description: 'Doors and furniture.',
      category: 'CARPENTRY',
      isActive: true,
      issues: [],
    });
    const detail = await get(`/api/services/${insertedId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.service.category, null);
    assert.ok((await get('/api/services')).body.services.some((item) => item.id === String(insertedId)));
    const adminList = await get('/api/admin/services?pageSize=100', { token: ctx.admin.token });
    assert.ok(adminList.body.services.some((item) => item.id === String(insertedId)));
    await Service.deleteOne({ _id: insertedId });

    // A provider registered before categories: empty list, sees no requests, can add some.
    await User.create({
      name: 'Old Provider',
      username: '9876531099',
      passwordHash: await hashPassword('Password123'),
      role: 'PROVIDER',
    });
    const login = await post('/api/auth/login', { body: { username: '9876531099', password: 'Password123' } });
    assert.equal(login.status, 200);
    assert.deepEqual(login.body.user.categories, []);
    const feed = await get('/api/provider/requests', { token: login.body.accessToken });
    assert.equal(feed.status, 200);
    assert.deepEqual(feed.body.requests, []);
    assert.equal(feed.body.needsCategories, true);

    const updated = await patch('/api/users/me', {
      token: login.body.accessToken,
      body: { categories: [ctx.categories.ac.id] },
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.user.categories.map((category) => category.name), ['AC']);
    const after = await get('/api/provider/requests', { token: login.body.accessToken });
    assert.equal(after.body.needsCategories, false);
  });
});

describe('provider categories', () => {
  it('signup asks for at least one valid, active category; several are allowed', async () => {
    const body = (categories) => ({
      name: 'Category Provider',
      phoneNumber: '9876532001',
      password: 'Password123',
      confirmPassword: 'Password123',
      shopLocation: SHOP_LOCATION,
      categories,
    });

    for (const categories of [undefined, [], 'AC', ['AC'], ['64b000000000000000000000'], [ctx.categories.hidden.id]]) {
      const result = await post('/api/auth/provider/signup', { body: body(categories) });
      assert.equal(result.status, 400, JSON.stringify(categories));
    }

    const created = await post('/api/auth/provider/signup', {
      body: body([ctx.categories.ac.id, ctx.categories.electrical.id, ctx.categories.ac.id]),
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.user.categories.map((category) => category.name).sort(), ['AC', 'Electrical']);

    const { default: User } = await import('../src/models/User.js');
    const stored = await User.findById(created.body.user.id).lean();
    assert.deepEqual(
      stored.categories.map(String).sort(),
      [ctx.categories.ac.id, ctx.categories.electrical.id].sort(),
      'only ids are stored on the provider',
    );

    const publicProfile = await get(`/api/providers/${created.body.user.id}`);
    assert.deepEqual(
      publicProfile.body.provider.categories.map((category) => category.name).sort(),
      ['AC', 'Electrical'],
    );
  });

  it('providers update their categories from the profile, validated', async () => {
    const provider = await signupProvider('Updating Provider', '9876532002', { categories: [ctx.categories.ac.id] });
    const updated = await patch('/api/users/me', {
      token: provider.token,
      body: { categories: [ctx.categories.plumbing.id, ctx.categories.electrical.id] },
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(
      updated.body.user.categories.map((category) => category.name).sort(),
      ['Electrical', 'Plumbing'],
    );
    assert.equal((await patch('/api/users/me', { token: provider.token, body: { categories: ['nope'] } })).status, 400);
    assert.equal((await patch('/api/users/me', { token: provider.token, body: { categories: 'AC' } })).status, 400);
  });

  it('providers only see and open requests in their categories', async () => {
    const acOnly = await signupProvider('AC Only', '9876532003', { categories: [ctx.categories.ac.id] });
    const plumbingOnly = await signupProvider('Plumbing Only', '9876532004', { categories: [ctx.categories.plumbing.id] });
    const acRequest = await createRequest(requestPayload(ctx.acRepair.id));
    const plumbingRequest = await createRequest(requestPayload(ctx.plumbing.id));
    ctx.categoryRequests = { acOnly, plumbingOnly, acRequest, plumbingRequest };

    const ids = async (token) =>
      (await get('/api/provider/requests', { token })).body.requests.map((item) => item.id);

    const acFeed = await ids(acOnly.token);
    assert.ok(acFeed.includes(acRequest.id));
    assert.equal(acFeed.includes(plumbingRequest.id), false);

    const plumbingFeed = await ids(plumbingOnly.token);
    assert.ok(plumbingFeed.includes(plumbingRequest.id));
    assert.equal(plumbingFeed.includes(acRequest.id), false);

    assert.equal((await get(`/api/provider/requests/${plumbingRequest.id}`, { token: acOnly.token })).status, 403);
    assert.equal((await get(`/api/provider/requests/${acRequest.id}`, { token: acOnly.token })).status, 200);

    // Admin's Provider View preview is not category-filtered.
    const adminFeed = await ids(ctx.admin.token);
    assert.ok(adminFeed.includes(acRequest.id) && adminFeed.includes(plumbingRequest.id));
  });

  it('a provider outside the service category cannot accept by calling the API', async () => {
    const { acOnly, plumbingOnly, plumbingRequest } = ctx.categoryRequests;
    const refused = await post(`/api/requests/${plumbingRequest.id}/accept`, { token: acOnly.token });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error.code, 'CATEGORY_NOT_ELIGIBLE');

    const request = await get(`/api/requests/${plumbingRequest.id}`, { requestToken: plumbingRequest.token });
    assert.equal(request.body.request.status, 'PENDING');
    assert.equal(request.body.request.selectedProviderId, null);

    assert.equal((await post(`/api/requests/${plumbingRequest.id}/accept`, { token: plumbingOnly.token })).status, 200);

    // The assignee keeps their job even after dropping that category.
    await patch('/api/users/me', { token: plumbingOnly.token, body: { categories: [ctx.categories.ac.id] } });
    assert.equal((await get(`/api/provider/requests/${plumbingRequest.id}`, { token: plumbingOnly.token })).status, 200);
    assert.equal((await post(`/api/requests/${plumbingRequest.id}/start`, { token: plumbingOnly.token })).status, 200);
  });

  it('a provider with no categories sees no requests and cannot accept any', async () => {
    const provider = await signupProvider('Emptied Provider', '9876532005', { categories: [ctx.categories.ac.id] });
    assert.equal((await patch('/api/users/me', { token: provider.token, body: { categories: [] } })).status, 200);
    const feed = await get('/api/provider/requests', { token: provider.token });
    assert.deepEqual(feed.body.requests, []);
    assert.equal(feed.body.needsCategories, true);
    const open = await createRequest(requestPayload(ctx.acRepair.id));
    assert.equal((await post(`/api/requests/${open.id}/accept`, { token: provider.token })).status, 403);
  });
});

describe('invoices', () => {
  before(async () => {
    ctx.invoiceProvider = await signupProvider('Invoice Provider', '9876533001', { categories: [ctx.categories.ac.id] });
    ctx.otherProvider = await signupProvider('Other Provider', '9876533002', { categories: [ctx.categories.ac.id] });
  });

  async function invoiceCount(filter) {
    const { default: Invoice } = await import('../src/models/Invoice.js');
    return Invoice.countDocuments(filter);
  }

  it('a completed job creates exactly one invoice that matches the job', async () => {
    const flow = await runFullFlow({ provider: ctx.invoiceProvider });
    ctx.invoiceFlow = flow;
    assert.equal(await invoiceCount({ bookingId: flow.bookingId }), 1);

    const result = await get(`/api/bookings/${flow.bookingId}/invoice`, { requestToken: flow.token });
    assert.equal(result.status, 200);
    const { invoice } = result.body;
    assert.match(invoice.invoiceNumber, /^4F-\d{6}$/);
    assert.equal(invoice.bookingId, flow.bookingId);
    assert.equal(invoice.requestId, flow.requestId);
    assert.equal(invoice.providerId, ctx.invoiceProvider.user.id);
    assert.deepEqual(invoice.provider, { name: 'Invoice Provider', phone: ctx.invoiceProvider.user.username });
    assert.deepEqual(invoice.customer, { name: 'Asha Customer', phone: '9876543210' });
    assert.deepEqual(invoice.service, { id: ctx.acRepair.id, name: 'AC Repair' });
    assert.equal(invoice.issueKey, 'NOT_COOLING');
    assert.equal(invoice.issueLabel, 'Not cooling');
    assert.equal(invoice.description, 'The unit runs but the air stays warm.');
    assert.equal('amount' in invoice, false, 'no amount is invented');

    const booking = await get(`/api/bookings/${flow.bookingId}`, { requestToken: flow.token });
    assert.equal(
      new Date(invoice.completedAt).getTime(),
      new Date(booking.body.booking.timeline.completedAt).getTime(),
    );
  });

  it('repeating completion or creation never duplicates the invoice', async () => {
    const { requestId, bookingId, token } = ctx.invoiceFlow;
    assert.equal((await post(`/api/requests/${requestId}/complete`, { token: ctx.invoiceProvider.token })).status, 409);

    const { ensureInvoiceForCompletedRequest } = await import('../src/services/invoice.service.js');
    await Promise.all([ensureInvoiceForCompletedRequest(requestId), ensureInvoiceForCompletedRequest(requestId)]);
    const first = await get(`/api/bookings/${bookingId}/invoice`, { requestToken: token });
    const second = await get(`/api/bookings/${bookingId}/invoice`, { token: ctx.invoiceProvider.token });
    assert.equal(first.body.invoice.invoiceNumber, second.body.invoice.invoiceNumber);
    assert.equal(await invoiceCount({ bookingId }), 1);
  });

  it('incomplete and cancelled jobs have no invoice', async () => {
    const accepted = await runFullFlow({ provider: ctx.invoiceProvider, complete: false });
    assert.equal(await invoiceCount({ bookingId: accepted.bookingId }), 0);
    const notYet = await get(`/api/bookings/${accepted.bookingId}/invoice`, { requestToken: accepted.token });
    assert.equal(notYet.status, 404);
    assert.equal(notYet.body.error.code, 'INVOICE_NOT_FOUND');

    await post(`/api/requests/${accepted.requestId}/start`, { token: ctx.invoiceProvider.token });
    assert.equal(
      (await get(`/api/bookings/${accepted.bookingId}/invoice`, { token: ctx.invoiceProvider.token })).status,
      404,
    );
    assert.equal(await invoiceCount({ bookingId: accepted.bookingId }), 0);

    const open = await createRequest(requestPayload(ctx.acRepair.id));
    await post(`/api/requests/${open.id}/cancel`, { requestToken: open.token });
    const { ensureInvoiceForCompletedRequest } = await import('../src/services/invoice.service.js');
    assert.equal(await ensureInvoiceForCompletedRequest(open.id), null);
    assert.equal(await invoiceCount({ requestId: open.id }), 0);
  });

  it('only the customer, the assigned provider and admin can read it', async () => {
    const { bookingId, token } = ctx.invoiceFlow;
    const path = `/api/bookings/${bookingId}/invoice`;
    const other = await runFullFlow({ provider: ctx.otherProvider });

    assert.equal((await get(path, { requestToken: token })).status, 200);
    assert.equal((await get(path, { token: ctx.invoiceProvider.token })).status, 200);
    const admin = await get(path, { token: ctx.admin.token });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.invoice.bookingId, bookingId);

    assert.equal((await get(path)).status, 401);
    assert.equal((await get(path, { requestToken: other.token })).status, 403, 'another customer token');
    assert.equal((await get(path, { requestToken: 'x'.repeat(43) })).status, 401, 'a forged token');
    assert.equal((await get(path, { token: ctx.otherProvider.token })).status, 403, 'an unrelated provider');
    assert.equal(
      (await get(`/api/bookings/${other.bookingId}/invoice`, { requestToken: token })).status,
      403,
      'changing the id in the URL',
    );
    assert.equal((await get('/api/bookings/64b000000000000000000000/invoice', { token: ctx.admin.token })).status, 404);
  });

  it('jobs completed before invoices existed get one on first view', async () => {
    const flow = await runFullFlow({ provider: ctx.invoiceProvider });
    const { default: Invoice } = await import('../src/models/Invoice.js');
    await Invoice.deleteOne({ bookingId: flow.bookingId });

    const result = await get(`/api/bookings/${flow.bookingId}/invoice`, { token: ctx.invoiceProvider.token });
    assert.equal(result.status, 200);
    assert.equal(await invoiceCount({ bookingId: flow.bookingId }), 1);
  });

  it('invoice data never leaks through request or service endpoints', async () => {
    const { requestId, token } = ctx.invoiceFlow;
    const request = await get(`/api/requests/${requestId}`, { requestToken: token });
    assert.equal(JSON.stringify(request.body).includes('invoiceNumber'), false);
    assert.equal(JSON.stringify((await get('/api/services')).body).includes('invoiceNumber'), false);
  });
});
