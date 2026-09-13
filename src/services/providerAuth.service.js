import OtpChallenge, { OTP_PURPOSES } from '../models/OtpChallenge.js';
import User, { USER_ROLES } from '../models/User.js';
import { sendProviderSignupOtp } from '../integrations/otpDelivery.integration.js';
import { ApiError } from '../utils/ApiError.js';
import { normalizePhoneNumber } from '../utils/normalizePhone.js';
import { hashPassword } from './password.service.js';
import {
  generateOtp,
  getOtpExpiryDate,
  getResendAvailableAt,
  getRetryAfterSeconds,
  hashOtp,
  verifyOtp,
} from './otp.service.js';
import { createAccessToken } from './token.service.js';
import { toSafeUser } from './userPresenter.service.js';
import { env } from '../config/env.js';

function validateSignupInput({ name, phoneNumber, password, confirmPassword }) {
  if (typeof name !== 'string' || name.trim().length < 2) {
    throw new ApiError(400, 'Name must be at least 2 characters', 'VALIDATION_ERROR');
  }

  if (name.trim().length > 120) {
    throw new ApiError(400, 'Name must be 120 characters or fewer', 'VALIDATION_ERROR');
  }

  normalizePhoneNumber(phoneNumber);

  if (typeof password !== 'string' || password.length < 8) {
    throw new ApiError(400, 'Password must be at least 8 characters', 'VALIDATION_ERROR');
  }

  if (password !== confirmPassword) {
    throw new ApiError(400, 'Password confirmation does not match', 'VALIDATION_ERROR');
  }
}

function validateOtpInput({ phoneNumber, otp }) {
  normalizePhoneNumber(phoneNumber);

  if (typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
    throw new ApiError(400, 'OTP must be 6 digits', 'VALIDATION_ERROR');
  }
}

async function assertProviderDoesNotExist(username) {
  const existingUser = await User.exists({ username });

  if (existingUser) {
    throw new ApiError(409, 'Provider account already exists', 'PROVIDER_EXISTS');
  }
}

async function createOrUpdateSignupChallenge({ name, username, passwordHash }) {
  const now = new Date();
  const existingChallenge = await OtpChallenge.findOne({
    username,
    purpose: OTP_PURPOSES.PROVIDER_SIGNUP,
  });

  if (existingChallenge?.expiresAt <= now) {
    await existingChallenge.deleteOne();
  } else if (existingChallenge?.resendAvailableAt > now) {
    throw new ApiError(429, 'OTP was recently sent', 'OTP_COOLDOWN', {
      retryAfterSeconds: getRetryAfterSeconds(existingChallenge.resendAvailableAt),
    });
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  const challengeData = {
    phoneNumber: username,
    username,
    name: name.trim(),
    passwordHash,
    otpHash,
    purpose: OTP_PURPOSES.PROVIDER_SIGNUP,
    expiresAt: getOtpExpiryDate(),
    attempts: 0,
    resendAvailableAt: getResendAvailableAt(),
  };

  const challenge = await OtpChallenge.findOneAndUpdate(
    { username, purpose: OTP_PURPOSES.PROVIDER_SIGNUP },
    {
      $set: challengeData,
      $inc: { resendCount: existingChallenge ? 1 : 0 },
    },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
  );

  await sendProviderSignupOtp(username, otp);

  return challenge;
}

export async function initiateProviderSignup(input) {
  validateSignupInput(input);

  const username = normalizePhoneNumber(input.phoneNumber);
  await assertProviderDoesNotExist(username);

  const passwordHash = await hashPassword(input.password);
  const challenge = await createOrUpdateSignupChallenge({
    name: input.name,
    username,
    passwordHash,
  });

  return {
    message: 'OTP sent for provider signup verification',
    username,
    expiresAt: challenge.expiresAt,
    resendAvailableAt: challenge.resendAvailableAt,
  };
}

export async function resendProviderSignupOtp(input) {
  const username = normalizePhoneNumber(input.phoneNumber);
  await assertProviderDoesNotExist(username);

  const now = new Date();
  const challenge = await OtpChallenge.findOne({
    username,
    purpose: OTP_PURPOSES.PROVIDER_SIGNUP,
  });

  if (!challenge || challenge.expiresAt <= now) {
    if (challenge) {
      await challenge.deleteOne();
    }

    throw new ApiError(404, 'No pending provider signup found', 'OTP_NOT_FOUND');
  }

  if (challenge.resendAvailableAt > now) {
    throw new ApiError(429, 'OTP was recently sent', 'OTP_COOLDOWN', {
      retryAfterSeconds: getRetryAfterSeconds(challenge.resendAvailableAt),
    });
  }

  const otp = generateOtp();
  challenge.otpHash = await hashOtp(otp);
  challenge.expiresAt = getOtpExpiryDate();
  challenge.attempts = 0;
  challenge.resendAvailableAt = getResendAvailableAt();
  challenge.resendCount += 1;
  await challenge.save();

  await sendProviderSignupOtp(username, otp);

  return {
    message: 'OTP resent for provider signup verification',
    username,
    expiresAt: challenge.expiresAt,
    resendAvailableAt: challenge.resendAvailableAt,
  };
}

export async function verifyProviderSignupOtp(input) {
  validateOtpInput(input);

  const username = normalizePhoneNumber(input.phoneNumber);
  const challenge = await OtpChallenge.findOne({
    username,
    purpose: OTP_PURPOSES.PROVIDER_SIGNUP,
  });

  if (!challenge) {
    throw new ApiError(400, 'OTP is invalid or expired', 'INVALID_OTP');
  }

  const now = new Date();

  if (challenge.expiresAt <= now) {
    await challenge.deleteOne();
    throw new ApiError(400, 'OTP is invalid or expired', 'INVALID_OTP');
  }

  if (challenge.attempts >= env.otpMaxAttempts) {
    throw new ApiError(429, 'Maximum OTP attempts exceeded', 'OTP_ATTEMPTS_EXCEEDED');
  }

  const otpMatches = await verifyOtp(input.otp, challenge.otpHash);

  if (!otpMatches) {
    challenge.attempts += 1;
    await challenge.save();

    if (challenge.attempts >= env.otpMaxAttempts) {
      throw new ApiError(429, 'Maximum OTP attempts exceeded', 'OTP_ATTEMPTS_EXCEEDED');
    }

    throw new ApiError(400, 'OTP is invalid or expired', 'INVALID_OTP');
  }

  await assertProviderDoesNotExist(username);

  const user = await User.create({
    name: challenge.name,
    username,
    passwordHash: challenge.passwordHash,
    role: USER_ROLES.PROVIDER,
    phoneVerifiedAt: new Date(),
    isActive: true,
  });

  await challenge.deleteOne();

  return {
    accessToken: createAccessToken(user),
    user: toSafeUser(user),
  };
}
