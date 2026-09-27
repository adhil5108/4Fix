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

import http from 'node:http';
import mongoose from 'mongoose';
import { io as connectClient } from 'socket.io-client';

let server;
let baseUrl;

export async function startTestServer() {
  const { default: app } = await import('../src/app.js');
  const { initSocket } = await import('../src/realtime/socket.js');

  await mongoose.connect(process.env.MONGODB_URI);

  if (mongoose.connection.name !== TEST_DATABASE) {
    throw new Error(`Refusing to run tests against database "${mongoose.connection.name}"`);
  }

  await mongoose.connection.dropDatabase();

  // Same wiring as server.js, so real-time events can be tested end to end.
  server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

export async function stopTestServer() {
  if (server) {
    const { closeSocket } = await import('../src/realtime/socket.js');
    await closeSocket();
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

// A Socket.IO client authenticated like the app's: `{ token }` (provider/admin JWT) or
// `{ requestToken }` (anonymous customer). Records every event it receives in `events`.
export async function connectSocket(auth) {
  const socket = connectClient(baseUrl, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
  socket.events = [];
  socket.onAny((event, payload) => socket.events.push({ event, payload }));

  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });

  return socket;
}

// Resolves once `socket` has received `count` events named `event` (or rejects).
export function waitForEvents(socket, event, count = 1, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const matches = socket.events.filter((item) => item.event === event).map((item) => item.payload);

      if (matches.length >= count) {
        clearInterval(timer);
        resolve(matches);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${count} × ${event} (got ${matches.length})`));
      }
    }, 20);
  });
}

// Lets in-flight socket events arrive before asserting that something was NOT received.
export const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

export const get = (path, options) => api('GET', path, options);
export const post = (path, options) => api('POST', path, options);
export const patch = (path, options) => api('PATCH', path, options);
export const del = (path, options) => api('DELETE', path, options);

export function dateOnly(daysFromNow) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

// Provider signup is address-only: the typed shop address is the shop location.
export const SHOP_LOCATION = { address: 'Koramangala 5th Block' };

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
