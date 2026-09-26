// Test environment is fixed before any src module is imported (env.js reads it at load).
const TEST_DATABASE = '4Fix_apitest';

process.env.MONGODB_URI = `mongodb://localhost:27017/${TEST_DATABASE}`;
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.JWT_ACCESS_SECRET = 'apitest-only-secret';
process.env.JWT_ACCESS_EXPIRES_IN = '1h';
process.env.PASSWORD_SALT_ROUNDS = '4';
// Anonymous endpoints are rate-limited per IP; the suite makes many calls from one IP.
process.env.ANON_REQUESTS_PER_HOUR = '100000';
process.env.ANON_UPLOADS_PER_HOUR = '100000';

import mongoose from 'mongoose';

let server;
let baseUrl;

export async function startTestServer() {
  const { default: app } = await import('../src/app.js');

  await mongoose.connect(process.env.MONGODB_URI);

  if (mongoose.connection.name !== TEST_DATABASE) {
    throw new Error(`Refusing to run tests against database "${mongoose.connection.name}"`);
  }

  await mongoose.connection.dropDatabase();

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

export async function stopTestServer() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}

// `token` is a provider/admin JWT; `requestToken` an anonymous customer's request access
// token (sent as X-Request-Token).
export async function api(method, path, { token, requestToken, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(requestToken ? { 'X-Request-Token': requestToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));

  return { status: response.status, body: payload };
}

export const get = (path, options) => api('GET', path, options);
export const post = (path, options) => api('POST', path, options);
export const patch = (path, options) => api('PATCH', path, options);
export const del = (path, options) => api('DELETE', path, options);

export function dateOnly(daysFromNow) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

export const SHOP_LOCATION = { latitude: 12.9352, longitude: 77.6245, address: 'Koramangala 5th Block' };

// Providers are the only accounts in V1.
export async function signupProvider(name, phoneNumber, { password = 'Password123', shopLocation = SHOP_LOCATION } = {}) {
  const result = await post('/api/auth/provider/signup', {
    body: { name, phoneNumber, password, confirmPassword: password, shopLocation },
  });

  if (result.status !== 201) {
    throw new Error(`Signup failed: ${JSON.stringify(result.body)}`);
  }

  return { token: result.body.accessToken, user: result.body.user };
}

// Anonymous customer: creates a request with no auth and returns it with its access token.
export async function createRequest(body) {
  const result = await post('/api/requests', { body });

  if (result.status !== 201) {
    throw new Error(`Create request failed: ${JSON.stringify(result.body)}`);
  }

  return { ...result.body.request, token: result.body.accessToken };
}

export function requestPayload(serviceId, overrides = {}) {
  return {
    serviceId,
    description: 'The unit runs but the air stays warm.',
    customerDetails: { name: 'Asha Customer', phone: '98765 43210' },
    attachments: [],
    address: {
      addressLine: '12 Lake View Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    },
    ...overrides,
  };
}
