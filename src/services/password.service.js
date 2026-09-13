import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

export function hashPassword(password) {
  return bcrypt.hash(password, env.passwordSaltRounds);
}

export function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}
