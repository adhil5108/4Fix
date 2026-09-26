import { ApiError } from '../utils/ApiError.js';

// Minimal fixed-window limiter for the endpoints anonymous customers can call (create a
// request, upload media). In-memory and per-process: a V1 abuse brake, not a security
// boundary. Limits come from env so tests and single-box deployments can tune them.
export function rateLimit({ name, max, windowMs }) {
  const hits = new Map();

  return (req, _res, next) => {
    // Authenticated providers/admins are accountable already; only anonymous callers count.
    if (req.user && req.user.role !== 'CUSTOMER') {
      next();
      return;
    }

    const now = Date.now();
    const key = `${name}:${req.ip}`;
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });

      if (hits.size > 10000) {
        for (const [storedKey, value] of hits) {
          if (value.resetAt <= now) hits.delete(storedKey);
        }
      }

      next();
      return;
    }

    entry.count += 1;

    if (entry.count > max) {
      next(new ApiError(429, 'Too many requests. Please try again later.', 'RATE_LIMITED'));
      return;
    }

    next();
  };
}

function limitFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const HOUR = 60 * 60 * 1000;

export const anonymousRequestLimit = rateLimit({
  name: 'create-request',
  max: limitFromEnv('ANON_REQUESTS_PER_HOUR', 20),
  windowMs: HOUR,
});

export const anonymousUploadLimit = rateLimit({
  name: 'upload',
  max: limitFromEnv('ANON_UPLOADS_PER_HOUR', 60),
  windowMs: HOUR,
});
