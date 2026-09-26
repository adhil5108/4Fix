import crypto from 'node:crypto';

// Anonymous customers own a request through a random bearer secret handed out once at
// creation. Only its SHA-256 hash is stored, so a database leak does not leak access.
export function generateAccessToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashAccessToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}
