import { getCurrentUser, loginUser } from '../services/auth.service.js';
import {
  signupCustomer as signupCustomerService,
  signupProvider as signupProviderService,
} from '../services/signup.service.js';

export async function login(req, res) {
  const result = await loginUser(req.body);

  res.status(200).json(result);
}

export async function signupProvider(req, res) {
  const result = await signupProviderService(req.body);

  res.status(201).json(result);
}

export async function signupCustomer(req, res) {
  const result = await signupCustomerService(req.body);

  res.status(201).json(result);
}

export async function me(req, res) {
  res.status(200).json(getCurrentUser(req.user));
}
