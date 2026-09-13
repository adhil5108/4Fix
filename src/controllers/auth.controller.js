import {
  initiateProviderSignup,
  resendProviderSignupOtp,
  verifyProviderSignupOtp,
} from '../services/providerAuth.service.js';
import { getCurrentUser, loginUser } from '../services/auth.service.js';

export async function login(req, res) {
  const result = await loginUser(req.body);

  res.status(200).json(result);
}

export async function signupProvider(req, res) {
  const result = await initiateProviderSignup(req.body);

  res.status(202).json(result);
}

export async function verifyProviderOtp(req, res) {
  const result = await verifyProviderSignupOtp(req.body);

  res.status(201).json(result);
}

export async function resendProviderOtp(req, res) {
  const result = await resendProviderSignupOtp(req.body);

  res.status(200).json(result);
}

export async function me(req, res) {
  res.status(200).json(getCurrentUser(req.user));
}
