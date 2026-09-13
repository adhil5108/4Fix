import { env } from '../config/env.js';

export async function sendProviderSignupOtp(phoneNumber, otp) {
  if (env.nodeEnv === 'production') {
    throw new Error('Production OTP delivery is not configured');
  }

  console.log(`[DEV OTP] Provider signup OTP for ${phoneNumber}: ${otp}`);
}
