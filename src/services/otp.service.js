import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

export function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

export function hashOtp(otp) {
  return bcrypt.hash(otp, env.passwordSaltRounds);
}

export function verifyOtp(otp, otpHash) {
  return bcrypt.compare(otp, otpHash);
}

export function getOtpExpiryDate() {
  return new Date(Date.now() + env.otpExpiryMinutes * 60 * 1000);
}

export function getResendAvailableAt() {
  return new Date(Date.now() + env.otpResendCooldownSeconds * 1000);
}

export function getRetryAfterSeconds(resendAvailableAt) {
  return Math.max(
    0,
    Math.ceil((resendAvailableAt.getTime() - Date.now()) / 1000),
  );
}
