import {
  getPayment as getPaymentService,
  markPaymentPaid as markPaymentPaidService,
} from '../services/payment.service.js';

export async function getPayment(req, res) {
  const result = await getPaymentService(req.user, req.params.bookingId);

  res.status(200).json(result);
}

export async function markPaymentPaid(req, res) {
  const result = await markPaymentPaidService(req.user, req.params.bookingId, req.body);

  res.status(200).json(result);
}
