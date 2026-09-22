import {
  getConversation as getConversationService,
  listMessages as listMessagesService,
  markMessagesRead as markMessagesReadService,
  openConversation as openConversationService,
  sendMessage as sendMessageService,
} from '../services/chat.service.js';

export async function openConversation(req, res) {
  const result = await openConversationService(req.user, req.params.bookingId);

  res.status(200).json(result);
}

export async function getConversation(req, res) {
  const result = await getConversationService(req.user, req.params.bookingId);

  res.status(200).json(result);
}

export async function listMessages(req, res) {
  const result = await listMessagesService(req.user, req.params.bookingId, req.query);

  res.status(200).json(result);
}

export async function sendMessage(req, res) {
  const result = await sendMessageService(req.user, req.params.bookingId, req.body);

  res.status(201).json(result);
}

export async function markMessagesRead(req, res) {
  const result = await markMessagesReadService(req.user, req.params.bookingId);

  res.status(200).json(result);
}
