import {
  acceptQuote as acceptQuoteService,
  createQuote as createQuoteService,
  listRequestQuotes as listRequestQuotesService,
  rejectQuote as rejectQuoteService,
} from '../services/quote.service.js';

export async function createQuote(req, res) {
  const result = await createQuoteService(req.user, req.params.requestId, req.body);

  res.status(201).json(result);
}

export async function listRequestQuotes(req, res) {
  const result = await listRequestQuotesService(req.user, req.params.requestId);

  res.status(200).json(result);
}

export async function acceptQuote(req, res) {
  const result = await acceptQuoteService(req.user, req.params.quoteId);

  res.status(200).json(result);
}

export async function rejectQuote(req, res) {
  const result = await rejectQuoteService(req.user, req.params.quoteId);

  res.status(200).json(result);
}
