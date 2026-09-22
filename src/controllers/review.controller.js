import {
  createReview as createReviewService,
  getReview as getReviewService,
  listProviderReviews as listProviderReviewsService,
} from '../services/review.service.js';

export async function createReview(req, res) {
  const result = await createReviewService(req.user, req.params.bookingId, req.body);

  res.status(201).json(result);
}

export async function getReview(req, res) {
  const result = await getReviewService(req.user, req.params.bookingId);

  res.status(200).json(result);
}

export async function listProviderReviews(req, res) {
  const result = await listProviderReviewsService(req.params.providerId);

  res.status(200).json(result);
}
