import { isSameId, toIdString } from '../utils/objectId.js';
import { isPopulated } from './requestPresenter.service.js';
import { toUserSummary } from './userPresenter.service.js';

export function toConversation(conversation, { unreadCount } = {}) {
  return {
    id: conversation.id,
    bookingId: toIdString(conversation.bookingId),
    customer: isPopulated(conversation.customerId)
      ? toUserSummary(conversation.customerId)
      : null,
    provider: isPopulated(conversation.providerId)
      ? toUserSummary(conversation.providerId)
      : null,
    customerId: toIdString(conversation.customerId),
    providerId: toIdString(conversation.providerId),
    unreadCount: unreadCount ?? 0,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

// `isMine` is computed for the requesting participant so clients need no id juggling.
export function toMessage(message, viewer) {
  return {
    id: message.id,
    conversationId: toIdString(message.conversationId),
    senderId: toIdString(message.senderId),
    isMine: isSameId(message.senderId, viewer.id),
    message: message.message,
    attachments: message.attachments,
    readAt: message.readAt,
    createdAt: message.createdAt,
  };
}
