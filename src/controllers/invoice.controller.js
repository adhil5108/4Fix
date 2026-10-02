import { getBookingInvoice } from '../services/invoice.service.js';

export async function getInvoice(req, res) {
  res.status(200).json(await getBookingInvoice(req.user, req.params.bookingId));
}
