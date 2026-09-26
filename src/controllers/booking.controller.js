import {
  getBooking as getBookingService,
  listBookings as listBookingsService,
} from '../services/booking.service.js';

export async function listBookings(req, res) {
  const result = await listBookingsService(req.user, req.query);

  res.status(200).json(result);
}

export async function getBooking(req, res) {
  const result = await getBookingService(req.user, req.params.bookingId);

  res.status(200).json(result);
}
