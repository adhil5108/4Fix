// Test environment is fixed before any src module is imported (env.js reads it at load).
const TEST_DATABASE = '4Fix_apitest';

process.env.MONGODB_URI = `mongodb://localhost:27017/${TEST_DATABASE}`;
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.JWT_ACCESS_SECRET = 'apitest-only-secret';
process.env.JWT_ACCESS_EXPIRES_IN = '1h';
process.env.PASSWORD_SALT_ROUNDS = '4';

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

export async function api(method, path, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));

  return { status: response.status, body: payload };
}

export const get = (path, options) => api('GET', path, options);
export const post = (path, options) => api('POST', path, options);
export const patch = (path, options) => api('PATCH', path, options);

export function dateOnly(daysFromNow) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

export async function signup(role, name, phoneNumber, password = 'Password123') {
  const path = role === 'PROVIDER' ? '/api/auth/provider/signup' : '/api/auth/customer/signup';
  const result = await post(path, {
    body: { name, phoneNumber, password, confirmPassword: password },
  });

  if (result.status !== 201) {
    throw new Error(`Signup failed: ${JSON.stringify(result.body)}`);
  }

  return { token: result.body.accessToken, user: result.body.user };
}

export function requestPayload(serviceId, overrides = {}) {
  return {
    serviceId,
    description: 'The unit runs but the air stays warm.',
    attachments: [],
    address: {
      addressLine: '12 Lake View Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    },
    preferredDate: dateOnly(2),
    preferredTime: '10:30',
    ...overrides,
  };
}
