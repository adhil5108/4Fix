import {
  getBooking as getBookingService,
  getTracking as getTrackingService,
  listBookings as listBookingsService,
  markArrived as markArrivedService,
  markOnTheWay as markOnTheWayService,
  updateLocation as updateLocationService,
} from '../services/booking.service.js';

export async function listBookings(req, res) {
  const result = await listBookingsService(req.user, req.query);

  res.status(200).json(result);
}

export async function getBooking(req, res) {
  const result = await getBookingService(req.user, req.params.bookingId);

  res.status(200).json(result);
}

export async function getTracking(req, res) {
  const result = await getTrackingService(req.user, req.params.bookingId);

  res.status(200).json(result);
}

export async function markOnTheWay(req, res) {
  const result = await markOnTheWayService(req.user, req.params.bookingId);

  res.status(200).json(result);
}

export async function markArrived(req, res) {
  const result = await markArrivedService(req.user, req.params.bookingId);

  res.status(200).json(result);
}

export async function updateLocation(req, res) {
  const result = await updateLocationService(req.user, req.params.bookingId, req.body);

  res.status(200).json(result);
}
